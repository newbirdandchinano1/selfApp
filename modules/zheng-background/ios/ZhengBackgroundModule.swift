import ExpoModulesCore
import UIKit

public class ZhengBackgroundModule: Module {
  private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
  private var backgroundRefCount = 0

  public func definition() -> ModuleDefinition {
    Name("ZhengBackground")

    AsyncFunction("moveToBackground") {
      await MainActor.run {
        UIApplication.shared.perform(#selector(NSXPCConnection.suspend))
      }
    }

    AsyncFunction("beginBackgroundExecution") {
      await MainActor.run {
        self.incrementBackgroundTask()
      }
    }

    AsyncFunction("endBackgroundExecution") {
      await MainActor.run {
        self.decrementBackgroundTask()
      }
    }
  }

  private func incrementBackgroundTask() {
    backgroundRefCount += 1
    guard backgroundTaskId == .invalid else { return }
    backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "ZhengAutoLedger") {
      self.backgroundRefCount = 0
      self.finishBackgroundTask()
    }
  }

  private func decrementBackgroundTask() {
    backgroundRefCount = max(0, backgroundRefCount - 1)
    if backgroundRefCount == 0 {
      finishBackgroundTask()
    }
  }

  private func finishBackgroundTask() {
    guard backgroundTaskId != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTaskId)
    backgroundTaskId = .invalid
  }
}
