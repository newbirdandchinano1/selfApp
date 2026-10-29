package expo.modules.zhengvisioncutout

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android 占位：人像抠图依赖 iOS Vision，此处明确失败以便 JS 侧降级提示。
 */
class ZhengVisionCutoutModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZhengVisionCutout")

    AsyncFunction("isAvailable") {
      false
    }

    AsyncFunction("cutOutPerson") { _: String, _: String? ->
      throw CodedException("ANDROID_UNSUPPORTED", "Vision 人像抠图仅支持 iOS 实机，当前为 Android。", null)
    }
  }
}
