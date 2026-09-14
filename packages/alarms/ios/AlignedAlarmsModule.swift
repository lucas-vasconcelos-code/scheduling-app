import ExpoModulesCore
import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
@available(iOS 26.0, *)
struct MeetingMetadata: AlarmMetadata { var meetingTitle: String }
#endif

public class AlignedAlarmsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AlignedAlarms")
    AsyncFunction("capability") { () -> [String: Any] in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return ["available": true, "authorized": AlarmManager.shared.authorizationState == .authorized, "reason": "Meeting alarms require AlarmKit permission."]
      }
      #endif
      return ["available": false, "authorized": false, "reason": "This iOS version uses notification reminders."]
    }
    AsyncFunction("requestPermission") { () async throws -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return try await AlarmManager.shared.requestAuthorization() == .authorized }
      #endif
      return false
    }
    AsyncFunction("schedule") { (key: String, title: String, seconds: Double) async throws -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        guard AlarmManager.shared.authorizationState == .authorized, seconds > Date().timeIntervalSince1970 else { return false }
        let defaults = UserDefaults.standard
        let storageKey = "aligned.alarm." + key
        let id = defaults.string(forKey: storageKey).flatMap(UUID.init(uuidString:)) ?? UUID()
        let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title), stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle"))
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert), metadata: MeetingMetadata(meetingTitle: title), tintColor: Color(red: 0.33, green: 0.54, blue: 0.46))
        let configuration = AlarmManager.AlarmConfiguration(countdownDuration: nil, schedule: .fixed(Date(timeIntervalSince1970: seconds)), attributes: attributes, stopIntent: nil, secondaryIntent: nil)
        _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
        defaults.set(id.uuidString, forKey: storageKey)
        return true
      }
      #endif
      return false
    }
    AsyncFunction("cancel") { (key: String) throws in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let storageKey = "aligned.alarm." + key
        if let stored = UserDefaults.standard.string(forKey: storageKey), let id = UUID(uuidString: stored) { try AlarmManager.shared.cancel(id: id) }
        UserDefaults.standard.removeObject(forKey: storageKey)
      }
      #endif
    }
  }
}
