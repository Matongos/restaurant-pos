//! TechPlug POS desktop app.
//!
//! The window opens the live TechPlug POS web app, so every restaurant always runs the newest version
//! without reinstalling. The web app saves itself on the computer (service worker) and keeps all
//! restaurant data on the computer too, so after the first start it opens and sells with no internet.
//!
//! Printing: the web app sends ready-made receipt-printer bytes (ESC/POS) here, and they go straight
//! to a Windows printer (or a network printer) with no print screen.
use tauri::Manager;

/// Printers installed in Windows (the receipt printer appears here once its driver is installed).
#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    winprint::list()
}

/// Sends raw receipt-printer bytes to a Windows printer, no print screen.
#[tauri::command]
async fn print_raw(printer: String, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || winprint::raw(&printer, &data))
        .await
        .map_err(|e| e.to_string())?
}

/// Sends raw receipt-printer bytes to a network (Wi-Fi / cable) printer, e.g. "192.168.1.50" (port 9100).
#[tauri::command]
async fn print_tcp(address: String, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use std::net::{TcpStream, ToSocketAddrs};
        use std::time::Duration;
        let addr = if address.contains(':') { address.clone() } else { format!("{address}:9100") };
        let sock = addr
            .to_socket_addrs()
            .map_err(|_| format!("\"{address}\" is not a printer address"))?
            .next()
            .ok_or_else(|| format!("\"{address}\" is not a printer address"))?;
        let mut s = TcpStream::connect_timeout(&sock, Duration::from_secs(4))
            .map_err(|_| format!("Could not reach the printer at {addr}. Is it on and on the same network?"))?;
        s.set_write_timeout(Some(Duration::from_secs(10))).ok();
        s.write_all(&data).map_err(|e| e.to_string())?;
        s.flush().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod winprint {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct PrinterInfo4 {
        name: *mut u16,
        server: *mut u16,
        attributes: u32,
    }
    #[repr(C)]
    struct DocInfo1 {
        doc_name: *const u16,
        output_file: *const u16,
        datatype: *const u16,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn EnumPrintersW(flags: u32, name: *const u16, level: u32, buf: *mut u8, cb: u32, needed: *mut u32, returned: *mut u32) -> i32;
        fn OpenPrinterW(name: *const u16, handle: *mut *mut c_void, defaults: *const c_void) -> i32;
        fn ClosePrinter(handle: *mut c_void) -> i32;
        fn StartDocPrinterW(handle: *mut c_void, level: u32, info: *const DocInfo1) -> u32;
        fn EndDocPrinter(handle: *mut c_void) -> i32;
        fn StartPagePrinter(handle: *mut c_void) -> i32;
        fn EndPagePrinter(handle: *mut c_void) -> i32;
        fn WritePrinter(handle: *mut c_void, buf: *const c_void, cb: u32, written: *mut u32) -> i32;
    }

    const PRINTER_ENUM_LOCAL: u32 = 2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 4;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }
    unsafe fn from_wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }

    pub fn list() -> Result<Vec<String>, String> {
        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let (mut needed, mut count) = (0u32, 0u32);
            EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut count);
            if needed == 0 {
                return Ok(vec![]);
            }
            // u64 buffer keeps the printer records properly aligned.
            let mut buf = vec![0u64; (needed as usize + 7) / 8];
            if EnumPrintersW(flags, null(), 4, buf.as_mut_ptr() as *mut u8, needed, &mut needed, &mut count) == 0 {
                return Err("Could not list the printers".into());
            }
            let items = std::slice::from_raw_parts(buf.as_ptr() as *const PrinterInfo4, count as usize);
            Ok(items.iter().map(|i| from_wide(i.name)).filter(|n| !n.is_empty()).collect())
        }
    }

    pub fn raw(printer: &str, data: &[u8]) -> Result<(), String> {
        unsafe {
            let name = wide(printer);
            let mut h: *mut c_void = null_mut();
            if OpenPrinterW(name.as_ptr(), &mut h, null()) == 0 || h.is_null() {
                return Err(format!("Printer \"{printer}\" not found. Is it switched on and installed?"));
            }
            let doc = wide("TechPlug POS ticket");
            let dtype = wide("RAW");
            let info = DocInfo1 { doc_name: doc.as_ptr(), output_file: null(), datatype: dtype.as_ptr() };
            if StartDocPrinterW(h, 1, &info) == 0 {
                ClosePrinter(h);
                return Err(format!("Printer \"{printer}\" would not start printing"));
            }
            StartPagePrinter(h);
            let mut written = 0u32;
            let ok = WritePrinter(h, data.as_ptr() as *const c_void, data.len() as u32, &mut written);
            EndPagePrinter(h);
            EndDocPrinter(h);
            ClosePrinter(h);
            if ok == 0 || written as usize != data.len() {
                return Err(format!("Printer \"{printer}\" did not take the ticket"));
            }
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod winprint {
    pub fn list() -> Result<Vec<String>, String> {
        Ok(vec![])
    }
    pub fn raw(_printer: &str, _data: &[u8]) -> Result<(), String> {
        Err("Windows printers only work in the Windows app".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opening the app a second time brings the open window to the front instead of a second till.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![list_printers, print_raw, print_tcp])
        .run(tauri::generate_context!())
        .expect("error while running TechPlug POS");
}
