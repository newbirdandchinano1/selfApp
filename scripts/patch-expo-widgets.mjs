/**
 * 加固 expo-widgets App Group 读写：
 * 1) UserDefaults suite 懒加载 + synchronize（避免主 App 写入扩展读不到）
 * 2) timeline timestamp 兼容 NSNumber/Double（UserDefaults 回读后 as? Int 常失败 → 永远 INITIAL）
 *
 * 在 postinstall 里执行；直接改 node_modules，重装依赖后会再打补丁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expoWidgets = path.join(root, 'node_modules', 'expo-widgets');

if (!fs.existsSync(expoWidgets)) {
  console.log('[patch-expo-widgets] expo-widgets not installed, skip');
  process.exit(0);
}

const MARK = '/* zheng-expo-widgets-patch-v1 */';

const storagePath = path.join(expoWidgets, 'ios', 'WidgetsStorage.swift');
const utilsPath = path.join(expoWidgets, 'ios', 'Widgets', 'Utils.swift');
const objectPath = path.join(expoWidgets, 'ios', 'WidgetObject.swift');

const STORAGE = `${MARK}
import Foundation

public enum WidgetsStorage {
  public static var appGroupIdentifier: String? = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String

  private static var cachedDefaults: UserDefaults?
  static var defaults: UserDefaults? {
    if let cachedDefaults {
      return cachedDefaults
    }
    let id =
      appGroupIdentifier
      ?? (Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String)
    appGroupIdentifier = id
    guard let id, !id.isEmpty else {
      return nil
    }
    let suite = UserDefaults(suiteName: id)
    cachedDefaults = suite
    return suite
  }

  static func set(_ value: [String: Any], forKey key: String) {
    guard let defaults else { return }
    defaults.set(value, forKey: key)
    defaults.synchronize()
  }

  static func set(_ value: [[String: Any]], forKey key: String) {
    guard let defaults else { return }
    defaults.set(value, forKey: key)
    defaults.synchronize()
  }

  static func set(_ value: String, forKey key: String) {
    guard let defaults else { return }
    defaults.set(value, forKey: key)
    defaults.synchronize()
  }

  static func set(_ value: Data, forKey key: String) {
    guard let defaults else { return }
    defaults.set(value, forKey: key)
    defaults.synchronize()
  }

  public static func getDictionary(forKey key: String) -> [String: Any]? {
    guard let defaults else { return nil }
    return defaults.dictionary(forKey: key)
  }

  public static func getArray(forKey key: String) -> [Any]? {
    guard let defaults else { return nil }
    return defaults.array(forKey: key)
  }

  public static func getData(forKey key: String) -> Data? {
    guard let defaults else { return nil }
    return defaults.data(forKey: key)
  }

  public static func getString(forKey key: String) -> String? {
    guard let defaults else { return nil }
    return defaults.string(forKey: key)
  }

  static func removeObject(forKey key: String) {
    guard let defaults else { return }
    defaults.removeObject(forKey: key)
    defaults.synchronize()
  }
}
`;

function patchUtils(src) {
  if (src.includes(MARK)) return src;
  if (src.includes('func expoWidgetsTimestampMs')) return src;

  const helper = `
${MARK}
func expoWidgetsTimestampMs(_ value: Any?) -> Int? {
  if let i = value as? Int { return i }
  if let i64 = value as? Int64 { return Int(i64) }
  if let d = value as? Double { return Int(d) }
  if let n = value as? NSNumber { return n.intValue }
  if let s = value as? String, let d = Double(s) { return Int(d) }
  return nil
}
`;

  let next = src.replace(
    /if let entry = entry as\? \[String: Any\], let timestamp = entry\["timestamp"\] as\? Int, let props = entry\["props"\] as\? \[String: Any\] \{/g,
    'if let entry = entry as? [String: Any], let timestamp = expoWidgetsTimestampMs(entry["timestamp"]), let props = entry["props"] as? [String: Any] {',
  );

  if (next === src) {
    throw new Error('Failed to patch Utils.swift timestamp cast');
  }

  // Insert helper after imports
  next = next.replace(
    /import Foundation\n/,
    `import Foundation\n${helper}\n`,
  );
  return next;
}

function patchWidgetObject(src) {
  if (src.includes(MARK)) return src;

  const old = `  func updateTimeline(entries: [WidgetsJSTimelineEntry]) throws {
    if WidgetsStorage.getString(forKey: "__expo_widgets_\\(name)_layout") == nil {
      throw UpdatedTimelineWithoutLayout(name)
    }
    WidgetsStorage.set(entries.map { $0.toDictionary() }, forKey: "__expo_widgets_\\(name)_timeline")

    self.reload()
  }`;

  const nextBlock = `  func updateTimeline(entries: [WidgetsJSTimelineEntry]) throws {
    ${MARK}
    guard WidgetsStorage.defaults != nil else {
      throw UpdatedTimelineWithoutLayout(name)
    }
    if WidgetsStorage.getString(forKey: "__expo_widgets_\\(name)_layout") == nil {
      throw UpdatedTimelineWithoutLayout(name)
    }
    // 显式写成 Int timestamp，避免 Record→UserDefaults→扩展 as? Int 丢条目后永远停在 INITIAL
    let payload: [[String: Any]] = entries.map { entry in
      [
        "timestamp": Int(entry.timestamp),
        "props": entry.props,
      ]
    }
    WidgetsStorage.set(payload, forKey: "__expo_widgets_\\(name)_timeline")

    self.reload()
  }`;

  if (!src.includes('func updateTimeline(entries: [WidgetsJSTimelineEntry]) throws')) {
    throw new Error('WidgetObject.swift missing updateTimeline');
  }

  // Flexible replace
  const replaced = src.replace(
    /func updateTimeline\(entries: \[WidgetsJSTimelineEntry\]\) throws \{[\s\S]*?\n  \}\n\n  func getTimeline/,
    `func updateTimeline(entries: [WidgetsJSTimelineEntry]) throws {
    ${MARK}
    guard WidgetsStorage.defaults != nil else {
      throw UpdatedTimelineWithoutLayout(name)
    }
    if WidgetsStorage.getString(forKey: "__expo_widgets_\\(name)_layout") == nil {
      throw UpdatedTimelineWithoutLayout(name)
    }
    let payload: [[String: Any]] = entries.map { entry in
      [
        "timestamp": Int(entry.timestamp),
        "props": entry.props,
      ]
    }
    WidgetsStorage.set(payload, forKey: "__expo_widgets_\\(name)_timeline")

    self.reload()
  }

  func getTimeline`,
  );

  if (replaced === src) {
    // try without MARK duplication concerns — write via old/new if exact match
    if (src.includes(old.replace(/\\\\/g, '\\'))) {
      return src.replace(old.replace(/\\\\/g, '\\'), nextBlock.replace(/\\\\/g, '\\'));
    }
    throw new Error('Failed to patch WidgetObject.swift updateTimeline');
  }
  return replaced;
}

fs.writeFileSync(storagePath, STORAGE, 'utf8');
console.log('✓ Patched WidgetsStorage.swift');

const utilsSrc = fs.readFileSync(utilsPath, 'utf8');
fs.writeFileSync(utilsPath, patchUtils(utilsSrc), 'utf8');
console.log('✓ Patched Utils.swift');

const objectSrc = fs.readFileSync(objectPath, 'utf8');
fs.writeFileSync(objectPath, patchWidgetObject(objectSrc), 'utf8');
console.log('✓ Patched WidgetObject.swift');

console.log('[patch-expo-widgets] done — rebuild iOS binary for native changes to take effect');
