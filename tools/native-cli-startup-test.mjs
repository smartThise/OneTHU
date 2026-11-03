/** Execute the production Rust launch/profile functions without Tauri or real accounts. */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const daemon=readFileSync('apps/desktop/src-tauri/src/cli_daemon.rs','utf8');
const security=readFileSync('apps/desktop/src-tauri/src/native_security.rs','utf8');
function fn(source,name){
 const expression=new RegExp(`^(?:pub(?:\\(crate\\))? )?fn ${name}\\b[\\s\\S]*?^}`,'m');
 const value=source.match(expression)?.[0];assert.ok(value,`Production Rust function ${name}`);return value;
}
const source=`use std::{fs::{self,OpenOptions},path::Path,process::{Command,Stdio},sync::{Arc,atomic::{AtomicBool,AtomicU64,Ordering}}};
#[cfg(unix)] mod libc { unsafe extern "C" { pub fn setsid() -> i32; } }
struct Manifest { build_id:String }
fn debug_log_line(_: &str) {}
mod native_security {
 use std::{path::Path,sync::atomic::{AtomicU64,Ordering}};
 static NEXT_FILE:AtomicU64=AtomicU64::new(0);
 ${fn(security,'private_atomic_write')}
}
${['unsafe_link','reject_link','private_directory','spawn_daemon'].map(name=>fn(daemon,name)).join('\n')}
#[cfg(test)] mod tests {
 use super::*;
 static NEXT:AtomicU64=AtomicU64::new(0);
 fn root()->std::path::PathBuf { std::env::temp_dir().join(format!("onethu-native-startup-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed))) }
 fn manifest()->Manifest {Manifest{build_id:"synthetic-runtime".into()}}
 #[test] fn retained_gui_data_and_missing_cli_profile_can_start() {
  let root=root();let runtime=root.join("runtime");let profile=root.join("missing parent").join("CLI profile [test]");
  fs::create_dir_all(runtime.join("bin")).unwrap();fs::create_dir_all(root.join("gui-state")).unwrap();
  let gui=root.join("gui-state/session.json");fs::write(&gui,b"retained synthetic GUI identity").unwrap();
  #[cfg(unix)] {fs::copy("/bin/sh",runtime.join("node")).unwrap();fs::write(runtime.join("bin/onethu.mjs"),b"exit 0\\n").unwrap();}
  #[cfg(windows)] {fs::copy(std::env::current_exe().unwrap(),runtime.join("node.exe")).unwrap();}
  let result=spawn_daemon(&runtime,&profile,&manifest());
  assert!(result.is_ok(),"native startup must create its missing profile before opening the log: {:?}",result.as_ref().err());
  let exited=result.unwrap();for _ in 0..500 {if exited.load(Ordering::Acquire){break;}std::thread::sleep(std::time::Duration::from_millis(10));}
  assert!(exited.load(Ordering::Acquire),"synthetic child must exit");assert!(profile.join("daemon-startup.log").is_file());
  assert_eq!(fs::read(&gui).unwrap(),b"retained synthetic GUI identity");
  #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;assert_eq!(fs::metadata(&profile).unwrap().permissions().mode()&0o777,0o700);}
  fs::remove_dir_all(root).unwrap();
 }
 #[test] fn profile_path_failure_has_a_structured_availability_error() {
  let root=root();fs::create_dir_all(&root).unwrap();let profile=root.join("a file is not a profile");fs::write(&profile,b"keep").unwrap();
  let result=spawn_daemon(&root,&profile,&manifest());assert_eq!(result.err().unwrap(),"CLI_DAEMON_INSTALL_UNAVAILABLE");assert_eq!(fs::read(&profile).unwrap(),b"keep");fs::remove_dir_all(root).unwrap();
 }
 #[test] fn missing_executable_has_a_structured_startup_error() {
  let root=root();let profile=root.join("new-profile");let result=spawn_daemon(&root,&profile,&manifest());assert_eq!(result.err().unwrap(),"CLI_DAEMON_START_FAILED");fs::remove_dir_all(root).unwrap();
 }
 #[cfg(unix)] #[test] fn symlink_profile_is_not_an_availability_fallback() {
  use std::os::unix::fs::symlink;let root=root();fs::create_dir_all(root.join("other")).unwrap();let profile=root.join("profile-link");symlink(root.join("other"),&profile).unwrap();
  assert_eq!(spawn_daemon(&root,&profile,&manifest()).err().unwrap(),"CLI_DAEMON_UNSAFE_PATH");assert!(!root.join("other/daemon-startup.log").exists());fs::remove_dir_all(root).unwrap();
 }
}
`;
const temp=mkdtempSync(path.join(tmpdir(),'onethu-native-startup-test-'));
try {
 const file=path.join(temp,'test.rs'),exe=path.join(temp,process.platform==='win32'?'test.exe':'test');writeFileSync(file,source);
 execFileSync('rustc',['--edition=2021','--test',file,'-o',exe],{stdio:'inherit'});
 execFileSync(exe,['--nocapture'],{stdio:'inherit',env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp}});
} finally {rmSync(temp,{recursive:true,force:true});}
