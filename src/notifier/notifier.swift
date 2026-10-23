// A macOS notification with two buttons, posted for the automation when the run waits for you.
// Built by src/notify.mjs into a small app (its own name in System Settings → Notifications).
//
// notifier --title T --message M [--show-label L] [--later-label L] [--timeout S] [--activate-pid P]
// Prints its pid, "posted" once shown, then the answer: show (the button or the notification
// clicked), later, dismissed or timeout. Exits 2 when notifications are not allowed. On SIGTERM
// the notification is taken away. Silent: the run plays its own sound.
import AppKit
import UserNotifications

let args = CommandLine.arguments
func arg(_ name: String, _ fallback: String = "") -> String {
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return fallback }
  return args[index + 1]
}
func say(_ line: String) {
  print(line)
  fflush(stdout)
}

let center = UNUserNotificationCenter.current()
let id = UUID().uuidString
func finish(_ answer: String, code: Int32 = 0) {
  center.removeDeliveredNotifications(withIdentifiers: [id])
  say(answer)
  // The removal is sent before the exit
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(code) }
}

/// The automation browser to the front, from this app, which the click has just made active
func activateBrowser() {
  guard let pid = Int32(arg("--activate-pid")), let browser = NSRunningApplication(processIdentifier: pid) else { return }
  NSApp.yieldActivation(to: browser)
  browser.activate(from: NSRunningApplication.current, options: [.activateAllWindows])
}

final class Delegate: NSObject, UNUserNotificationCenterDelegate {
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list])
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    completionHandler()
    switch response.actionIdentifier {
    case "show", UNNotificationDefaultActionIdentifier:
      activateBrowser()
      finish("show")
    case "later":
      finish("later")
    default:
      finish("dismissed")
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
center.delegate = delegate
// Opened by a click on a notification of a run that is over: nothing to do
if arg("--title").isEmpty {
  DispatchQueue.main.asyncAfter(deadline: .now() + 1) { exit(0) }
} else {
  say("pid \(getpid())")
  let show = UNNotificationAction(identifier: "show", title: arg("--show-label", "Show browser"), options: [.foreground])
  let later = UNNotificationAction(identifier: "later", title: arg("--later-label", "Later"), options: [])
  center.setNotificationCategories([UNNotificationCategory(identifier: "wait", actions: [show, later], intentIdentifiers: [], options: [.customDismissAction])])
  center.requestAuthorization(options: [.alert, .sound]) { granted, error in
    guard granted else {
      say("denied\(error.map { " \($0.localizedDescription)" } ?? "")")
      exit(2)
    }
    let content = UNMutableNotificationContent()
    content.title = arg("--title")
    content.body = arg("--message")
    content.categoryIdentifier = "wait"
    center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
      if let error {
        say("error \(error.localizedDescription)")
        exit(3)
      }
      say("posted")
    }
  }
  signal(SIGTERM, SIG_IGN)
  let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
  stop.setEventHandler { finish("ended") }
  stop.resume()
  DispatchQueue.main.asyncAfter(deadline: .now() + (Double(arg("--timeout", "3600")) ?? 3600)) { finish("timeout") }
}
app.run()
