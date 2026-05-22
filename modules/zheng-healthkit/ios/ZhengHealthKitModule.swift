import ExpoModulesCore
import HealthKit

public class ZhengHealthKitModule: Module {
  private let store = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("ZhengHealthKit")

    AsyncFunction("isAvailable") { () -> Bool in
      await MainActor.run {
        HKHealthStore.isHealthDataAvailable()
      }
    }

    AsyncFunction("requestAuthorization") { () -> Bool in
      await self.requestReadAuthorization()
    }

    AsyncFunction("fetchAllHealthData") { () -> [String: Any] in
      await self.buildSnapshot()
    }
  }

  // MARK: - Authorization

  @MainActor
  private func requestReadAuthorization() async -> Bool {
    guard HKHealthStore.isHealthDataAvailable() else { return false }
    let readTypes = Self.readObjectTypes()
    return await withCheckedContinuation { continuation in
      store.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes) { success, _ in
        continuation.resume(returning: success)
      }
    }
  }

  private static func readObjectTypes() -> Set<HKObjectType> {
    var set = Set<HKObjectType>()

    for id: HKCharacteristicTypeIdentifier in [
      .dateOfBirth, .biologicalSex, .bloodType, .fitzpatrickSkinType, .wheelchairUse,
    ] {
      if let t = HKObjectType.characteristicType(forIdentifier: id) { set.insert(t) }
    }

    for id: HKQuantityTypeIdentifier in quantityIdentifiers() {
      if let t = HKQuantityType.quantityType(forIdentifier: id) { set.insert(t) }
    }

    if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
      set.insert(sleep)
    }

    return set
  }

  private static func quantityIdentifiers() -> [HKQuantityTypeIdentifier] {
    [
      .bodyMass,
      .height,
      .bodyMassIndex,
      .stepCount,
      .activeEnergyBurned,
      .heartRate,
      .restingHeartRate,
      .oxygenSaturation,
      .bloodPressureSystolic,
      .bloodPressureDiastolic,
      .dietaryWater,
    ]
  }

  private static let cumulativeIds: Set<HKQuantityTypeIdentifier> = [
    .stepCount, .activeEnergyBurned, .dietaryWater,
  ]

  // MARK: - Snapshot

  @MainActor
  private func buildSnapshot() async -> [String: Any] {
    var payload: [String: Any] = [
      "available": HKHealthStore.isHealthDataAvailable(),
      "authorized": false,
      "fetchedAt": iso8601Now(),
      "characteristics": [String: String](),
      "quantities": [[String: Any]](),
      "categories": [[String: Any]](),
      "errors": [String](),
    ]

    guard HKHealthStore.isHealthDataAvailable() else { return payload }

    payload["authorized"] = await requestReadAuthorization()

    var characteristics = [String: String]()
    var errors = [String]()

    if let dob = try? store.dateOfBirthComponents(), let date = Calendar.current.date(from: dob) {
      characteristics["dateOfBirth"] = iso8601Date(date)
    }
    if let sex = try? store.biologicalSex() {
      characteristics["biologicalSex"] = biologicalSexLabel(sex.biologicalSex)
    }
    if let blood = try? store.bloodType() {
      characteristics["bloodType"] = bloodTypeLabel(blood.bloodType)
    }
    if let skin = try? store.fitzpatrickSkinType() {
      characteristics["fitzpatrickSkinType"] = fitzpatrickLabel(skin.skinType)
    }
    if let wheelchair = try? store.wheelchairUse() {
      characteristics["wheelchairUse"] = wheelchairLabel(wheelchair.wheelchairUse)
    }
    payload["characteristics"] = characteristics

    let now = Date()
    let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now
    let startOfToday = Calendar.current.startOfDay(for: now)

    var quantities = [[String: Any]]()
    for id in Self.quantityIdentifiers() {
      guard let qType = HKQuantityType.quantityType(forIdentifier: id) else { continue }
      do {
        if Self.cumulativeIds.contains(id) {
          if let row = try await fetchCumulative(type: qType, identifier: id.rawValue, start: startOfToday, end: now, label: "今日") {
            quantities.append(row)
          }
          if let row = try await fetchCumulative(type: qType, identifier: id.rawValue, start: weekAgo, end: now, label: "近7日") {
            quantities.append(row)
          }
        } else if let row = try await fetchLatest(type: qType, identifier: id.rawValue) {
          quantities.append(row)
        }
      } catch {
        errors.append("\(id.rawValue): \(error.localizedDescription)")
      }
    }
    payload["quantities"] = quantities

    var categories = [[String: Any]]()
    if let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
      do {
        categories.append(contentsOf: try await fetchRecentCategories(type: sleepType, identifier: HKCategoryTypeIdentifier.sleepAnalysis.rawValue, limit: 5))
      } catch {
        errors.append("sleep: \(error.localizedDescription)")
      }
    }
    payload["categories"] = categories
    payload["errors"] = errors
    payload["fetchedAt"] = iso8601Now()

    return payload
  }

  // MARK: - Queries (main thread)

  @MainActor
  private func fetchLatest(type: HKQuantityType, identifier: String) async throws -> [String: Any]? {
    try await withCheckedThrowingContinuation { continuation in
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: [sort]) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let sample = samples?.first as? HKQuantitySample,
              let row = Self.row(from: sample, identifier: identifier, aggregation: "latest") else {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: row)
      }
      store.execute(query)
    }
  }

  @MainActor
  private func fetchCumulative(
    type: HKQuantityType,
    identifier: String,
    start: Date,
    end: Date,
    label: String
  ) async throws -> [String: Any]? {
    try await withCheckedThrowingContinuation { continuation in
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let sum = stats?.sumQuantity(),
              let row = Self.row(from: sum, type: type, identifier: identifier, start: start, end: end, aggregation: label) else {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: row)
      }
      store.execute(query)
    }
  }

  @MainActor
  private func fetchRecentCategories(type: HKCategoryType, identifier: String, limit: Int) async throws -> [[String: Any]] {
    try await withCheckedThrowingContinuation { continuation in
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: limit, sortDescriptors: [sort]) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let rows = (samples as? [HKCategorySample] ?? []).map { sample -> [String: Any] in
          [
            "identifier": identifier,
            "value": self.categoryValueLabel(sample),
            "startDate": self.iso8601Date(sample.startDate),
            "endDate": self.iso8601Date(sample.endDate),
            "source": sample.sourceRevision.source.name,
          ]
        }
        continuation.resume(returning: rows)
      }
      store.execute(query)
    }
  }

  // MARK: - Safe quantity conversion (wrong HKUnit causes native crash)

  private static func row(
    from sample: HKQuantitySample,
    identifier: String,
    aggregation: String
  ) -> [String: Any]? {
    row(from: sample.quantity, type: sample.quantityType, identifier: identifier, start: sample.startDate, end: sample.endDate, source: sample.sourceRevision.source.name, aggregation: aggregation)
  }

  private static func row(
    from quantity: HKQuantity,
    type: HKQuantityType,
    identifier: String,
    start: Date,
    end: Date,
    aggregation: String,
    source: String = "HealthKit"
  ) -> [String: Any]? {
    guard let unit = compatibleUnit(for: type),
          quantity.is(compatibleWith: unit) else { return nil }
    let value = jsonSafe(quantity.doubleValue(for: unit))
    return [
      "identifier": identifier,
      "value": value,
      "unit": unit.unitString,
      "startDate": iso8601DateStatic(start),
      "endDate": iso8601DateStatic(end),
      "source": source,
      "aggregation": aggregation,
    ]
  }

  private static func compatibleUnit(for type: HKQuantityType) -> HKUnit? {
    switch type.identifier {
    case HKQuantityTypeIdentifier.bodyMass.rawValue,
         HKQuantityTypeIdentifier.leanBodyMass.rawValue:
      return .gramUnit(with: .kilo)
    case HKQuantityTypeIdentifier.height.rawValue:
      return .meterUnit(with: .centi)
    case HKQuantityTypeIdentifier.bodyMassIndex.rawValue:
      return .count()
    case HKQuantityTypeIdentifier.stepCount.rawValue:
      return .count()
    case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
      return .kilocalorie()
    case HKQuantityTypeIdentifier.heartRate.rawValue,
         HKQuantityTypeIdentifier.restingHeartRate.rawValue:
      return HKUnit.count().unitDivided(by: .minute())
    case HKQuantityTypeIdentifier.oxygenSaturation.rawValue:
      return .percent()
    case HKQuantityTypeIdentifier.bloodPressureSystolic.rawValue,
         HKQuantityTypeIdentifier.bloodPressureDiastolic.rawValue:
      return .millimeterOfMercury()
    case HKQuantityTypeIdentifier.dietaryWater.rawValue:
      return .literUnit(with: .milli)
    default:
      return nil
    }
  }

  private static func jsonSafe(_ value: Double) -> Double {
    guard value.isFinite else { return 0 }
    return value
  }

  // MARK: - Labels

  private func categoryValueLabel(_ sample: HKCategorySample) -> String {
    if sample.categoryType.identifier == HKCategoryTypeIdentifier.sleepAnalysis.rawValue {
      switch sample.value {
      case HKCategoryValueSleepAnalysis.inBed.rawValue: return "在床上"
      case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: return "睡眠"
      case HKCategoryValueSleepAnalysis.awake.rawValue: return "清醒"
      case HKCategoryValueSleepAnalysis.asleepCore.rawValue: return "核心睡眠"
      case HKCategoryValueSleepAnalysis.asleepDeep.rawValue: return "深睡"
      case HKCategoryValueSleepAnalysis.asleepREM.rawValue: return "REM"
      default: return "睡眠(\(sample.value))"
      }
    }
    return String(sample.value)
  }

  private func biologicalSexLabel(_ sex: HKBiologicalSex) -> String {
    switch sex {
    case .female: return "女"
    case .male: return "男"
    case .other: return "其他"
    default: return "未设置"
    }
  }

  private func bloodTypeLabel(_ type: HKBloodType) -> String {
    switch type {
    case .aPositive: return "A+"
    case .aNegative: return "A-"
    case .bPositive: return "B+"
    case .bNegative: return "B-"
    case .abPositive: return "AB+"
    case .abNegative: return "AB-"
    case .oPositive: return "O+"
    case .oNegative: return "O-"
    default: return "未知"
    }
  }

  private func fitzpatrickLabel(_ type: HKFitzpatrickSkinType) -> String {
    switch type {
    case .I: return "I型"
    case .II: return "II型"
    case .III: return "III型"
    case .IV: return "IV型"
    case .V: return "V型"
    case .VI: return "VI型"
    default: return "未知"
    }
  }

  private func wheelchairLabel(_ use: HKWheelchairUse) -> String {
    switch use { case .yes: return "是"; case .no: return "否"; default: return "未设置" }
  }

  private func iso8601Now() -> String { Self.iso8601DateStatic(Date()) }

  private func iso8601Date(_ date: Date) -> String { Self.iso8601DateStatic(date) }

  private static func iso8601DateStatic(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }
}
