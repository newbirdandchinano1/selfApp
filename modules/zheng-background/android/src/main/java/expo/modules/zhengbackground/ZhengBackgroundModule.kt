package expo.modules.zhengbackground

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ZhengBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZhengBackground")

    AsyncFunction("moveToBackground") {
      val activity = appContext.currentActivity
      activity?.moveTaskToBack(true)
    }
  }
}
