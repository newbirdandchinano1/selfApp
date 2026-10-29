import CoreImage
import CoreImage.CIFilterBuiltins
import ExpoModulesCore
import UIKit
import Vision

/**
 * 端上人像抠图：Vision 人像蒙版 + Core Image 合成透明 PNG。
 * 仅实机可靠；模拟器上 VNGeneratePersonSegmentationRequest 通常不可用。
 */
public class ZhengVisionCutoutModule: Module {
  private let ciContext = CIContext(options: nil)

  public func definition() -> ModuleDefinition {
    Name("ZhengVisionCutout")

    AsyncFunction("isAvailable") { () -> Bool in
      #if targetEnvironment(simulator)
      return false
      #else
      if #available(iOS 15.0, *) {
        return true
      }
      return false
      #endif
    }

    AsyncFunction("cutOutPerson") { (imageUri: String, quality: String?) -> [String: String] in
      try self.performCutOut(imageUri: imageUri, quality: quality)
    }
  }

  private func performCutOut(imageUri: String, quality: String?) throws -> [String: String] {
    #if targetEnvironment(simulator)
    throw Exception(
      name: "SIMULATOR_UNSUPPORTED",
      description: "Vision 人像抠图需在 iOS 实机上运行，模拟器不可用。"
    )
    #else
    if #available(iOS 15.0, *) {
      return try Self.runPersonCutOut(
        imageUri: imageUri,
        quality: quality,
        ciContext: ciContext
      )
    }
    throw Exception(name: "IOS_VERSION", description: "需要 iOS 15 及以上。")
    #endif
  }

  @available(iOS 15.0, *)
  private static func runPersonCutOut(
    imageUri: String,
    quality: String?,
    ciContext: CIContext
  ) throws -> [String: String] {
    let url = try resolveFileURL(from: imageUri)
    guard let rawImage = UIImage(contentsOfFile: url.path) else {
      throw Exception(name: "IMAGE_LOAD_FAILED", description: "无法读取图片：\(url.path)")
    }
    let image = normalizedUpOrientation(rawImage)
    guard let cgImage = image.cgImage else {
      throw Exception(name: "IMAGE_INVALID", description: "图片无效，缺少 CGImage。")
    }

    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = qualityLevel(from: quality)
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8

    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      throw Exception(
        name: "VISION_FAILED",
        description: "Vision 人像分割失败：\(error.localizedDescription)"
      )
    }

    guard let observation = request.results?.first else {
      throw Exception(name: "NO_PERSON", description: "未检测到人物，请换一张带人的穿搭照片。")
    }

    let inputCI = CIImage(cgImage: cgImage)
    let maskCI = CIImage(cvPixelBuffer: observation.pixelBuffer)
    let scaleX = inputCI.extent.width / max(maskCI.extent.width, 1)
    let scaleY = inputCI.extent.height / max(maskCI.extent.height, 1)
    let scaledMask = maskCI.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

    if try maskLooksEmpty(scaledMask, context: ciContext) {
      throw Exception(name: "NO_PERSON", description: "未检测到人物，请换一张带人的穿搭照片。")
    }

    let blend = CIFilter.blendWithMask()
    blend.inputImage = inputCI
    blend.maskImage = scaledMask
    blend.backgroundImage = CIImage.empty()

    guard let output = blend.outputImage?.cropped(to: inputCI.extent) else {
      throw Exception(name: "BLEND_FAILED", description: "蒙版合成失败。")
    }

    guard let outCG = ciContext.createCGImage(output, from: inputCI.extent) else {
      throw Exception(name: "RENDER_FAILED", description: "无法渲染透明 PNG。")
    }

    guard let pngData = UIImage(cgImage: outCG).pngData() else {
      throw Exception(name: "PNG_ENCODE_FAILED", description: "PNG 编码失败。")
    }

    let outURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("zheng-cutout-\(UUID().uuidString).png")
    do {
      try pngData.write(to: outURL, options: .atomic)
    } catch {
      throw Exception(
        name: "WRITE_FAILED",
        description: "写入结果失败：\(error.localizedDescription)"
      )
    }

    return ["uri": outURL.absoluteString]
  }

  @available(iOS 15.0, *)
  private static func qualityLevel(from raw: String?) -> VNGeneratePersonSegmentationRequest.QualityLevel {
    switch (raw ?? "accurate").lowercased() {
    case "fast":
      return .fast
    case "balanced":
      return .balanced
    default:
      return .accurate
    }
  }

  private static func resolveFileURL(from imageUri: String) throws -> URL {
    let trimmed = imageUri.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      throw Exception(name: "EMPTY_URI", description: "图片路径为空。")
    }
    if trimmed.hasPrefix("file:") {
      guard let url = URL(string: trimmed) else {
        throw Exception(name: "BAD_URI", description: "无法解析 file URI。")
      }
      return url
    }
    if trimmed.hasPrefix("/") {
      return URL(fileURLWithPath: trimmed)
    }
    if let url = URL(string: trimmed), url.isFileURL {
      return url
    }
    throw Exception(
      name: "UNSUPPORTED_URI",
      description: "仅支持本地 file:// 或绝对路径，收到：\(trimmed.prefix(80))"
    )
  }

  private static func normalizedUpOrientation(_ image: UIImage) -> UIImage {
    if image.imageOrientation == .up {
      return image
    }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = image.scale
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
  }

  private static func maskLooksEmpty(_ mask: CIImage, context: CIContext) throws -> Bool {
    guard let filter = CIFilter(name: "CIAreaAverage") else {
      return false
    }
    filter.setValue(mask, forKey: kCIInputImageKey)
    filter.setValue(CIVector(cgRect: mask.extent), forKey: kCIInputExtentKey)
    guard let avg = filter.outputImage else { return false }

    var pixel = [UInt8](repeating: 0, count: 4)
    context.render(
      avg,
      toBitmap: &pixel,
      rowBytes: 4,
      bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
      format: .RGBA8,
      colorSpace: CGColorSpaceCreateDeviceRGB()
    )
    return Int(pixel[0]) < 8
  }
}
