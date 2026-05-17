import ExpoModulesCore
import UIKit

public class ZhengBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZhengBackground")

    AsyncFunction("moveToBackground") {
      await MainActor.run {
        UIApplication.shared.perform(#selector(NSXPCConnection.suspend))
      }
    }
  }
}
