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

    AsyncFunction("beginBackgroundExecution") {
      val context = appContext.reactContext ?: return@AsyncFunction
      ZhengBackgroundForegroundService.begin(context)
    }

    AsyncFunction("endBackgroundExecution") {
      val context = appContext.reactContext ?: return@AsyncFunction
      ZhengBackgroundForegroundService.end(context)
    }
  }
}
