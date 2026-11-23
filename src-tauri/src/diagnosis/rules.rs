//! Bộ quy tắc của Smart Diagnosis: hàm thuần `Snapshot -> Vec<Finding>` (Analyze + Recommend).
//! Không đụng hệ thống => test được đầy đủ bằng dữ liệu giả. Ngưỡng cố định, ghi rõ trong code.

use serde::Serialize;

use crate::usage::UnusedSummary;

const GB: u64 = 1024 * 1024 * 1024;
const MB: u64 = 1024 * 1024;
const DAY_SECS: u64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Ok,
    Info,
    Warn,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Memory,
    Storage,
    Startup,
    Apps,
    Windows,
    Hardware,
}

/// Cách xử lý. Không có hành động nào tự xoá/đổi gì: `Boost` chạy sau hộp xác nhận, `Open` mở đúng
/// trang để người dùng xem trước và tự xác nhận như bình thường.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Action {
    Boost,
    Open { page: &'static str, label: &'static str },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Mã quy tắc — dùng để so trước/sau khi quét lại (Verify).
    pub id: &'static str,
    pub category: Category,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    /// Số liệu chính để so trước/sau (vd "còn 8% (19 GB)").
    pub metric: Option<String>,
    pub action: Option<Action>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveSpace {
    pub letter: char,
    pub total: u64,
    pub free: u64,
    pub system: bool,
}

/// Dữ liệu thu thập được (Scan). Trường `None` = không đọc được => quy tắc tương ứng bỏ qua.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub mem_total: u64,
    pub mem_avail: u64,
    pub commit_total: u64,
    pub commit_limit: u64,
    pub drives: Vec<DriveSpace>,
    pub junk_bytes: Option<u64>,
    pub recycle_bytes: Option<u64>,
    pub startup_enabled: Option<usize>,
    pub unused: Option<UnusedSummary>,
    pub pending_reboot: bool,
    pub windows_old: bool,
    /// Từ lần khởi động lại THẬT (Restart) gần nhất.
    pub since_restart_secs: Option<u64>,
    pub fast_startup: bool,
    /// (đang chạy, thanh hỗ trợ) MT/s khi RAM chạy chậm hơn mức hỗ trợ.
    pub ram_slow: Option<(u32, u32)>,
    pub ram_slots_free: Option<u32>,
    /// Mọi ổ trong máy đều là HDD (=> Windows chắc chắn trên HDD).
    pub all_disks_hdd: bool,
    /// Chỉ có khi "Quét sâu": dọn WinSxS lúc này có tác dụng (DISM khuyên + lần dọn trước không vô ích).
    pub winsxs_recommended: Option<bool>,
}

pub fn fmt_bytes(n: u64) -> String {
    if n >= GB {
        format!("{:.1} GB", n as f64 / GB as f64)
    } else {
        format!("{} MB", n / MB)
    }
}

fn pct(part: u64, total: u64) -> u64 {
    part.saturating_mul(100).checked_div(total).unwrap_or(0)
}

const fn open(page: &'static str, label: &'static str) -> Option<Action> {
    Some(Action::Open { page, label })
}

fn finding(id: &'static str, category: Category, severity: Severity, title: impl Into<String>, detail: impl Into<String>) -> Finding {
    Finding { id, category, severity, title: title.into(), detail: detail.into(), metric: None, action: None }
}

impl Finding {
    fn metric(mut self, m: impl Into<String>) -> Self {
        self.metric = Some(m.into());
        self
    }
    fn action(mut self, a: Option<Action>) -> Self {
        self.action = a;
        self
    }
}

fn memory(s: &Snapshot, out: &mut Vec<Finding>) {
    if s.mem_total == 0 {
        return;
    }
    let free_pct = pct(s.mem_avail, s.mem_total);
    let m = format!("{free_pct}% free ({})", fmt_bytes(s.mem_avail));
    let f = match free_pct {
        // RAM thật sự thiếu: cache (standby) khi ấy vốn đã nhỏ — cách duy nhất có tác dụng là đóng bớt app
        // nặng. Boost (nhẹ) chỉ ghi trang modified xuống đĩa, là phụ.
        0..10 => finding("ram", Category::Memory, Severity::Critical, "RAM is nearly full", "Your PC may slow down, stutter, or freeze. Close apps using a lot of memory (open Processes and sort by memory). Boost may only help a little.")
            .action(open("processes", "Open Processes")),
        10..20 => finding("ram", Category::Memory, Severity::Warn, "High memory usage", "Boost writes pending (modified) data to disk to free memory. If this happens often, check which apps are using the most RAM.")
            .action(Some(Action::Boost)),
        _ => finding("ram", Category::Memory, Severity::Ok, "RAM looks good", "There is enough available memory."),
    };
    out.push(f.metric(m));
    if s.commit_limit > 0 && pct(s.commit_total, s.commit_limit) >= 90 {
        out.push(
            finding("commit", Category::Memory, Severity::Warn, "Virtual memory is nearly full", "The total memory requested by apps is close to the limit (RAM + page file). Apps may report low memory or close unexpectedly.")
                .metric(format!("{}% of limit", pct(s.commit_total, s.commit_limit)))
                .action(open("processes", "View processes")),
        );
    }
}

fn storage(s: &Snapshot, out: &mut Vec<Finding>) {
    for d in &s.drives {
        let free_pct = pct(d.free, d.total);
        let m = format!("Drive {}: {free_pct}% free ({})", d.letter, fmt_bytes(d.free));
        let (id, sev) = match (d.system, free_pct, d.free) {
            (true, p, f) if p < 10 || f < 10 * GB => ("disk-system", Severity::Critical),
            (true, p, f) if p < 20 || f < 20 * GB => ("disk-system", Severity::Warn),
            (true, ..) => ("disk-system", Severity::Ok),
            (false, p, _) if p < 5 => ("disk-other", Severity::Warn),
            _ => continue,
        };
        let f = match sev {
            Severity::Ok => finding(id, Category::Storage, sev, format!("Drive {} has enough free space", d.letter), "The system drive has plenty of free space."),
            _ if d.system => finding(
                id,
                Category::Storage,
                sev,
                format!("System drive {} is low on space", d.letter),
                "Windows needs free space for updates and temporary files; a full drive can slow down your PC. Clean up junk, remove large or duplicate files, or uninstall apps you no longer use.",
            )
            .action(open("cleaner", "Clean junk")),
            _ => finding(id, Category::Storage, sev, format!("Drive {} is low on space", d.letter), "Review large files and duplicates on this drive.")
                .action(open("disk", "View disks")),
        };
        out.push(f.metric(m));
    }
    match s.junk_bytes {
        Some(b) if b >= GB => out.push(
            finding("junk", Category::Storage, Severity::Warn, format!("{} of junk can be cleaned", fmt_bytes(b)), "Temporary files, caches, and error reports… Review the results and choose what to clean.")
                .metric(fmt_bytes(b))
                .action(open("cleaner", "Review & clean")),
        ),
        Some(b) if b >= 200 * MB => out.push(
            finding("junk", Category::Storage, Severity::Info, format!("{} of junk can be cleaned", fmt_bytes(b)), "Not much — clean it up when convenient.")
                .metric(fmt_bytes(b))
                .action(open("cleaner", "Review & clean")),
        ),
        Some(b) => out.push(finding("junk", Category::Storage, Severity::Ok, "Little junk found", "There are not many temporary files or caches to clean.").metric(fmt_bytes(b))),
        None => {}
    }
    if let Some(b) = s.recycle_bytes.filter(|&b| b >= GB) {
        out.push(
            finding("recycle", Category::Storage, Severity::Info, format!("Recycle Bin is using {}", fmt_bytes(b)), "Review the Recycle Bin, then empty it to free up space.")
                .metric(fmt_bytes(b))
                .action(open("cleaner", "Review Recycle Bin")),
        );
    }
}

fn startup(s: &Snapshot, out: &mut Vec<Finding>) {
    let Some(n) = s.startup_enabled else { return };
    let f = match n {
        15.. => finding("startup", Category::Startup, Severity::Warn, format!("{n} apps start with Windows"), "Too many startup apps can slow boot and use memory. Disable apps you do not need (this does not uninstall them).")
            .action(open("startup", "View startup apps")),
        8.. => finding("startup", Category::Startup, Severity::Info, format!("{n} apps start with Windows"), "You may be able to disable apps that do not need to run at startup.")
            .action(open("startup", "View startup apps")),
        _ => finding("startup", Category::Startup, Severity::Ok, "Few startup apps", "Startup time is unlikely to be affected much."),
    };
    out.push(f.metric(format!("{n} app")));
}

fn apps(s: &Snapshot, out: &mut Vec<Finding>) {
    let Some(u) = &s.unused else { return };
    if u.count == 0 || u.bytes < GB {
        out.push(finding("apps-unused", Category::Apps, Severity::Ok, "No large unused apps found", "No apps that have been unused for a long time are taking up significant space."));
        return;
    }
    let names = u.top.iter().map(|t| t.0.as_str()).collect::<Vec<_>>().join(", ");
    out.push(
        finding(
            "apps-unused",
            Category::Apps,
            Severity::Info,
            format!("{} apps unused for over 6 months ({})", u.count, fmt_bytes(u.bytes)),
            format!("Largest: {names}. Uninstall apps you no longer need to free up space."),
        )
        .metric(format!("{} app · {}", u.count, fmt_bytes(u.bytes)))
        .action(open("apps", "View apps")),
    );
}

fn windows(s: &Snapshot, out: &mut Vec<Finding>) {
    if s.pending_reboot {
        out.push(finding(
            "reboot-pending",
            Category::Windows,
            Severity::Warn,
            "Windows is waiting for a restart",
            "An update needs a restart to finish. Choose Restart (not Shut down) when convenient.",
        ));
    }
    if let Some(secs) = s.since_restart_secs.filter(|&x| x >= 14 * DAY_SECS) {
        let days = secs / DAY_SECS;
        let why = if s.fast_startup {
            " Fast Startup is enabled, so shutting down and turning your PC back on does not reset Windows — only Restart does."
        } else {
            ""
        };
        out.push(
            finding(
                "restart",
                Category::Windows,
                Severity::Info,
                format!("No full restart in {days} days"),
                format!("Restarting can free memory held for a long time and apply updates.{why}"),
            )
            .metric(format!("{days} days")),
        );
    }
    if s.windows_old {
        out.push(
            finding("windows-old", Category::Windows, Severity::Info, "Previous Windows installation remains (Windows.old)", "It often takes up 10–30 GB. Remove it only if you are sure you will not need to roll back to the previous version of Windows.")
                .action(open("cleaner", "View system cleanup")),
        );
    }
    if s.winsxs_recommended == Some(true) {
        out.push(
            finding("winsxs", Category::Windows, Severity::Info, "WinSxS cleanup recommended", "DISM recommends cleaning up old components that have been replaced by newer updates.")
                .action(open("cleaner", "View system cleanup")),
        );
    }
    if !out.iter().any(|f| f.category == Category::Windows) {
        out.push(finding("windows", Category::Windows, Severity::Ok, "Windows looks good", "No restart is pending and no previous Windows installation was found."));
    }
}

/// Thanh RAM chạy chậm hơn mức hỗ trợ đáng kể (≥ 200 MT/s) => (đang chạy, tối đa). Chỉ xét RAM rời của
/// máy bàn (`DIMM`): laptop (SODIMM/RAM hàn) hầu như không có XMP/EXPO, và nhiều firmware ghi `Speed` là
/// mức tối đa của khe chứ không phải của thanh RAM => gợi ý sai.
pub fn xmp_candidate(slots: &[&crate::hwinfo::smbios::MemorySlot]) -> Option<(u32, u32)> {
    slots
        .iter()
        .filter(|m| m.form_factor.as_deref() == Some("DIMM"))
        .filter_map(|m| Some((m.configured_mts?, m.speed_mts?)))
        .find(|(now, max)| now < max && max - now >= 200)
}

fn hardware(s: &Snapshot, out: &mut Vec<Finding>) {
    let before = out.len();
    if let Some((now, max)) = s.ram_slow {
        out.push(
            finding(
                "ram-xmp",
                Category::Hardware,
                Severity::Info,
                "RAM is running below its rated speed",
                "Enable XMP (Intel) / EXPO (AMD) in BIOS to run RAM at its rated speed. Only do this if you are comfortable changing BIOS settings.",
            )
            .metric(format!("{now} / {max} MT/s")),
        );
    }
    if s.all_disks_hdd {
        out.push(finding(
            "hdd",
            Category::Hardware,
            Severity::Info,
            "Windows is running on a hard disk drive",
            "An SSD can make startup and app launches much faster — it is often the most worthwhile upgrade for a PC with a hard drive.",
        ));
    }
    let ram_tight = s.mem_total > 0 && pct(s.mem_avail, s.mem_total) < 20;
    if let Some(n) = s.ram_slots_free.filter(|&n| n > 0 && ram_tight) {
        out.push(
            finding("ram-upgrade", Category::Hardware, Severity::Info, format!("{n} RAM slots are free"), "Your PC often runs low on memory — consider adding a RAM module (check the type on the System Info page).")
                .action(open("system", "View system info")),
        );
    }
    if out.len() == before {
        out.push(finding("hardware", Category::Hardware, Severity::Ok, "Hardware looks good", "No obvious bottlenecks were found."));
    }
}

/// Analyze + Recommend: mọi vấn đề / mục ổn, sắp theo mức độ (nặng trước).
pub fn analyze(s: &Snapshot) -> Vec<Finding> {
    let mut out = Vec::new();
    memory(s, &mut out);
    storage(s, &mut out);
    startup(s, &mut out);
    apps(s, &mut out);
    windows(s, &mut out);
    hardware(s, &mut out);
    out.sort_by_key(|f| std::cmp::Reverse(f.severity));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn healthy() -> Snapshot {
        Snapshot {
            mem_total: 16 * GB,
            mem_avail: 8 * GB,
            commit_total: 10 * GB,
            commit_limit: 30 * GB,
            drives: vec![DriveSpace { letter: 'C', total: 500 * GB, free: 200 * GB, system: true }],
            junk_bytes: Some(50 * MB),
            recycle_bytes: Some(0),
            startup_enabled: Some(4),
            unused: Some(UnusedSummary::default()),
            since_restart_secs: Some(2 * DAY_SECS),
            ..Snapshot::default()
        }
    }

    fn by_id<'a>(f: &'a [Finding], id: &str) -> Option<&'a Finding> {
        f.iter().find(|x| x.id == id)
    }

    #[test]
    fn healthy_machine_has_only_ok_findings() {
        let f = analyze(&healthy());
        assert!(f.iter().all(|x| x.severity == Severity::Ok), "{f:#?}");
        for c in [Category::Memory, Category::Storage, Category::Startup, Category::Apps, Category::Windows, Category::Hardware] {
            assert!(f.iter().any(|x| x.category == c), "each category has at least one finding: {c:?}");
        }
    }

    #[test]
    fn low_ram_and_full_system_disk_are_flagged_with_actions() {
        let s = Snapshot {
            mem_avail: GB, // ~6%
            drives: vec![
                DriveSpace { letter: 'C', total: 256 * GB, free: 15 * GB, system: true },
                DriveSpace { letter: 'D', total: 1000 * GB, free: 20 * GB, system: false },
            ],
            junk_bytes: Some(3 * GB),
            ..healthy()
        };
        let f = analyze(&s);
        assert_eq!(f[0].severity, Severity::Critical, "highest severity comes first");
        let ram = by_id(&f, "ram").unwrap();
        assert_eq!(ram.severity, Severity::Critical);
        assert!(matches!(ram.action, Some(Action::Open { page: "processes", .. })), "RAM < 10%: closing apps is the primary action");
        let c = by_id(&f, "disk-system").unwrap();
        assert_eq!(c.severity, Severity::Critical, "C: 15/256 GB free = 5% < 10%");
        assert!(matches!(c.action, Some(Action::Open { page: "cleaner", .. })));
        assert_eq!(by_id(&f, "disk-other").unwrap().severity, Severity::Warn, "D: 2% free");
        assert_eq!(by_id(&f, "junk").unwrap().severity, Severity::Warn);
    }

    #[test]
    fn system_disk_warn_band() {
        let d = |free_gb| {
            let s = Snapshot { drives: vec![DriveSpace { letter: 'C', total: 500 * GB, free: free_gb * GB, system: true }], ..healthy() };
            by_id(&analyze(&s), "disk-system").unwrap().severity
        };
        assert_eq!(d(49), Severity::Critical, "9.8%");
        assert_eq!(d(60), Severity::Warn, "12%");
        assert_eq!(d(100), Severity::Ok, "20%");
    }

    #[test]
    fn thresholds_are_exclusive_at_boundaries() {
        let at = |avail_gb| analyze(&Snapshot { mem_total: 100 * GB, mem_avail: avail_gb * GB, ..healthy() });
        assert_eq!(by_id(&at(9), "ram").unwrap().severity, Severity::Critical);
        assert_eq!(by_id(&at(10), "ram").unwrap().severity, Severity::Warn);
        assert_eq!(by_id(&at(20), "ram").unwrap().severity, Severity::Ok);
        let st = |n| by_id(&analyze(&Snapshot { startup_enabled: Some(n), ..healthy() }), "startup").unwrap().severity;
        assert_eq!((st(7), st(8), st(15)), (Severity::Ok, Severity::Info, Severity::Warn));
    }

    #[test]
    fn windows_and_hardware_hints() {
        let s = Snapshot {
            pending_reboot: true,
            since_restart_secs: Some(20 * DAY_SECS),
            fast_startup: true,
            windows_old: true,
            ram_slow: Some((2133, 3200)),
            all_disks_hdd: true,
            mem_avail: 2 * GB,
            ram_slots_free: Some(2),
            ..healthy()
        };
        let f = analyze(&s);
        assert_eq!(by_id(&f, "reboot-pending").unwrap().severity, Severity::Warn);
        assert!(by_id(&f, "restart").unwrap().detail.contains("Fast Startup"));
        assert!(by_id(&f, "windows-old").is_some());
        assert!(by_id(&f, "windows").is_none(), "do not report Windows as healthy when there is an issue");
        assert_eq!(by_id(&f, "ram-xmp").unwrap().metric.as_deref(), Some("2133 / 3200 MT/s"));
        assert!(by_id(&f, "hdd").is_some());
        assert!(by_id(&f, "ram-upgrade").is_some(), "high RAM usage with free slots");
    }

    #[test]
    fn xmp_only_suggested_for_desktop_dimm() {
        use crate::hwinfo::smbios::MemorySlot;
        let slot = |ff: &str| MemorySlot {
            size_mb: Some(8192),
            speed_mts: Some(3200),
            configured_mts: Some(2133),
            form_factor: Some(ff.into()),
            ..Default::default()
        };
        let (dimm, sodimm) = (slot("DIMM"), slot("SODIMM"));
        assert_eq!(xmp_candidate(&[&sodimm]), None, "laptops should not be offered XMP");
        assert_eq!(xmp_candidate(&[&dimm]), Some((2133, 3200)));
        let unknown = MemorySlot { form_factor: None, ..slot("DIMM") };
        assert_eq!(xmp_candidate(&[&unknown]), None, "do not guess when the memory type is unknown");
        let close = MemorySlot { configured_mts: Some(3100), ..slot("DIMM") };
        assert_eq!(xmp_candidate(&[&close]), None, "difference < 200 MT/s");
    }

    #[test]
    fn missing_data_skips_rules_instead_of_guessing() {
        let f = analyze(&Snapshot::default());
        assert!(by_id(&f, "ram").is_none());
        assert!(by_id(&f, "junk").is_none());
        assert!(by_id(&f, "startup").is_none());
    }
}
