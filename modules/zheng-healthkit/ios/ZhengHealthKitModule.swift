import ExpoModulesCore
import HealthKit

public class ZhengHealthKitModule: Module {
  private let store = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("ZhengHealthKit")

    AsyncFunction("isAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    AsyncFunction("requestAuthorization") { () -> Bool in
      guard HKHealthStore.isHealthDataAvailable() else { return false }
      let readTypes = Self.allReadObjectTypes()
      return await withCheckedContinuation { continuation in
        self.store.requestAuthorization(toShare: [], read: readTypes) { success, _ in
          continuation.resume(returning: success)
        }
      }
    }

    AsyncFunction("fetchAllHealthData") { () -> [String: Any] in
      await self.buildSnapshot()
    }
  }

  // MARK: - Types

  private static func allReadObjectTypes() -> Set<HKObjectType> {
    var set = Set<HKObjectType>()

    let characteristicIds: [HKCharacteristicTypeIdentifier] = [
      .dateOfBirth,
      .biologicalSex,
      .bloodType,
      .fitzpatrickSkinType,
      .wheelchairUse,
    ]
    for id in characteristicIds {
      if let t = HKObjectType.characteristicType(forIdentifier: id) {
        set.insert(t)
      }
    }

    for id in quantityIdentifiers() {
      if let t = HKQuantityType.quantityType(forIdentifier: id) {
        set.insert(t)
      }
    }

    for id in categoryIdentifiers() {
      if let t = HKCategoryType.categoryType(forIdentifier: id) {
        set.insert(t)
      }
    }

    return set
  }

  private static func quantityIdentifiers() -> [HKQuantityTypeIdentifier] {
    [
      .bodyMass,
      .height,
      .bodyMassIndex,
      .bodyFatPercentage,
      .leanBodyMass,
      .waistCircumference,
      .stepCount,
      .distanceWalkingRunning,
      .distanceCycling,
      .flightsClimbed,
      .activeEnergyBurned,
      .basalEnergyBurned,
      .appleExerciseTime,
      .appleStandTime,
      .heartRate,
      .restingHeartRate,
      .walkingHeartRateAverage,
      .heartRateVariabilitySDNN,
      .oxygenSaturation,
      .respiratoryRate,
      .vo2Max,
      .bloodPressureSystolic,
      .bloodPressureDiastolic,
      .bloodGlucose,
      .insulinDelivery,
      .dietaryEnergyConsumed,
      .dietaryProtein,
      .dietaryCarbohydrates,
      .dietaryFatTotal,
      .dietarySugar,
      .dietaryFiber,
      .dietarySodium,
      .dietaryWater,
      .dietaryCaffeine,
      .numberOfAlcoholicBeverages,
      .environmentalAudioExposure,
      .headphoneAudioExposure,
      .numberOfTimesFallen,
      .sixMinuteWalkTestDistance,
      .walkingSpeed,
      .walkingStepLength,
      .walkingAsymmetryPercentage,
      .walkingDoubleSupportPercentage,
      .stairAscentSpeed,
      .stairDescentSpeed,
    ]
  }

  private static func categoryIdentifiers() -> [HKCategoryTypeIdentifier] {
    [
      .sleepAnalysis,
      .appleStandHour,
      .mindfulSession,
      .highHeartRateEvent,
      .lowHeartRateEvent,
      .irregularHeartRhythmEvent,
      .lowCardioFitnessEvent,
      .sexualActivity,
      .intermenstrualBleeding,
      .menstrualFlow,
      .ovulationTestResult,
      .pregnancy,
      .pregnancyTestResult,
      .progesteroneTestResult,
      .cervicalMucusQuality,
      .contraceptive,
      .lactation,
    ]
  }

  private static let cumulativeQuantityIds: Set<HKQuantityTypeIdentifier> = [
    .stepCount,
    .distanceWalkingRunning,
    .distanceCycling,
    .flightsClimbed,
    .activeEnergyBurned,
    .basalEnergyBurned,
    .appleExerciseTime,
    .appleStandTime,
    .dietaryEnergyConsumed,
    .dietaryProtein,
    .dietaryCarbohydrates,
    .dietaryFatTotal,
    .dietarySugar,
    .dietaryFiber,
    .dietarySodium,
    .dietaryWater,
    .dietaryCaffeine,
    .numberOfAlcoholicBeverages,
    .environmentalAudioExposure,
    .headphoneAudioExposure,
    .numberOfTimesFallen,
  ]

  // MARK: - Snapshot

  private func buildSnapshot() async -> [String: Any] {
    var payload: [String: Any] = [
      "available": HKHealthStore.isHealthDataAvailable(),
      "authorized": false,
      "fetchedAt": iso8601Now(),
      "characteristics": [:] as [String: String],
      "quantities": [] as [[String: Any]],
      "categories": [] as [[String: Any]],
      "errors": [] as [String],
    ]

    guard HKHealthStore.isHealthDataAvailable() else {
      return payload
    }

    let authorized = await withCheckedContinuation { continuation in
      let readTypes = Self.allReadObjectTypes()
      store.requestAuthorization(toShare: [], read: readTypes) { success, _ in
        continuation.resume(returning: success)
      }
    }
    payload["authorized"] = authorized

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
        if Self.cumulativeQuantityIds.contains(id) {
          if let row = try await fetchCumulativeQuantity(
            type: qType,
            identifier: id.rawValue,
            start: startOfToday,
            end: now,
            label: "今日"
          ) {
            quantities.append(row)
          }
          if let row = try await fetchCumulativeQuantity(
            type: qType,
            identifier: id.rawValue,
            start: weekAgo,
            end: now,
            label: "近7日"
          ) {
            quantities.append(row)
          }
        } else if let row = try await fetchLatestQuantity(type: qType, identifier: id.rawValue) {
          quantities.append(row)
        }
      } catch {
        errors.append("\(id.rawValue): \(error.localizedDescription)")
      }
    }

    payload["quantities"] = quantities

    var categories = [[String: Any]]()
    for id in Self.categoryIdentifiers() {
      guard let cType = HKCategoryType.categoryType(forIdentifier: id) else { continue }
      do {
        let rows = try await fetchRecentCategorySamples(type: cType, identifier: id.rawValue, limit: 3)
        categories.append(contentsOf: rows)
      } catch {
        errors.append("\(id.rawValue): \(error.localizedDescription)")
      }
    }
    payload["categories"] = categories
    payload["errors"] = errors
    payload["fetchedAt"] = iso8601Now()

    return payload
  }

  // MARK: - Queries

  private func fetchLatestQuantity(type: HKQuantityType, identifier: String) async throws -> [String: Any]? {
    try await withCheckedThrowingContinuation { continuation in
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(
        sampleType: type,
        predicate: nil,
        limit: 1,
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let sample = samples?.first as? HKQuantitySample else {
          continuation.resume(returning: nil)
          return
        }
        let unit = Self.preferredUnit(for: type)
        let value = sample.quantity.doubleValue(for: unit)
        continuation.resume(returning: [
          "identifier": identifier,
          "value": value,
          "unit": unit.unitString,
          "startDate": self.iso8601Date(sample.startDate),
          "endDate": self.iso8601Date(sample.endDate),
          "source": sample.sourceRevision.source.name,
          "aggregation": "latest",
        ])
      }
      store.execute(query)
    }
  }

  private func fetchCumulativeQuantity(
    type: HKQuantityType,
    identifier: String,
    start: Date,
    end: Date,
    label: String
  ) async throws -> [String: Any]? {
    try await withCheckedThrowingContinuation { continuation in
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
      let query = HKStatisticsQuery(
        quantityType: type,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum
      ) { _, stats, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let sum = stats?.sumQuantity() else {
          continuation.resume(returning: nil)
          return
        }
        let unit = Self.preferredUnit(for: type)
        let value = sum.doubleValue(for: unit)
        continuation.resume(returning: [
          "identifier": identifier,
          "value": value,
          "unit": unit.unitString,
          "startDate": self.iso8601Date(start),
          "endDate": self.iso8601Date(end),
          "source": "HealthKit",
          "aggregation": label,
        ])
      }
      store.execute(query)
    }
  }

  private func fetchRecentCategorySamples(
    type: HKCategoryType,
    identifier: String,
    limit: Int
  ) async throws -> [[String: Any]] {
    try await withCheckedThrowingContinuation { continuation in
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(
        sampleType: type,
        predicate: nil,
        limit: limit,
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let rows: [[String: Any]] = (samples as? [HKCategorySample] ?? []).map { sample in
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

  // MARK: - Formatting

  private static func preferredUnit(for type: HKQuantityType) -> HKUnit {
    switch type.identifier {
    case HKQuantityTypeIdentifier.bodyMass.rawValue,
         HKQuantityTypeIdentifier.leanBodyMass.rawValue:
      return .gramUnit(with: .kilo)
    case HKQuantityTypeIdentifier.height.rawValue,
         HKQuantityTypeIdentifier.waistCircumference.rawValue,
         HKQuantityTypeIdentifier.sixMinuteWalkTestDistance.rawValue,
         HKQuantityTypeIdentifier.walkingStepLength.rawValue:
      return .meter()
    case HKQuantityTypeIdentifier.stepCount.rawValue,
         HKQuantityTypeIdentifier.flightsClimbed.rawValue,
         HKQuantityTypeIdentifier.numberOfTimesFallen.rawValue,
         HKQuantityTypeIdentifier.numberOfAlcoholicBeverages.rawValue:
      return .count()
    case HKQuantityTypeIdentifier.heartRate.rawValue,
         HKQuantityTypeIdentifier.restingHeartRate.rawValue,
         HKQuantityTypeIdentifier.walkingHeartRateAverage.rawValue,
         HKQuantityTypeIdentifier.respiratoryRate.rawValue:
      return HKUnit.count().unitDivided(by: .minute())
    case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue,
         HKQuantityTypeIdentifier.basalEnergyBurned.rawValue,
         HKQuantityTypeIdentifier.dietaryEnergyConsumed.rawValue:
      return .kilocalorie()
    case HKQuantityTypeIdentifier.appleExerciseTime.rawValue,
         HKQuantityTypeIdentifier.appleStandTime.rawValue:
      return .minute()
    case HKQuantityTypeIdentifier.distanceWalkingRunning.rawValue,
         HKQuantityTypeIdentifier.distanceCycling.rawValue:
      return .meterUnit(with: .kilo)
    case HKQuantityTypeIdentifier.dietaryWater.rawValue:
      return .literUnit(with: .milli)
    case HKQuantityTypeIdentifier.bloodGlucose.rawValue:
      return HKUnit.gramUnit(with: .milli).unitDivided(by: .literUnit(with: .deci))
    case HKQuantityTypeIdentifier.bloodPressureSystolic.rawValue,
         HKQuantityTypeIdentifier.bloodPressureDiastolic.rawValue:
      return .millimeterOfMercury()
    case HKQuantityTypeIdentifier.oxygenSaturation.rawValue,
         HKQuantityTypeIdentifier.bodyFatPercentage.rawValue,
         HKQuantityTypeIdentifier.walkingAsymmetryPercentage.rawValue,
         HKQuantityTypeIdentifier.walkingDoubleSupportPercentage.rawValue,
         HKQuantityTypeIdentifier.atrialFibrillationBurden.rawValue:
      return .percent()
    case HKQuantityTypeIdentifier.dietarySodium.rawValue:
      return .gramUnit(with: .milli)
    case HKQuantityTypeIdentifier.environmentalAudioExposure.rawValue,
         HKQuantityTypeIdentifier.headphoneAudioExposure.rawValue:
      return .decibelAWeightedSoundPressureLevel()
    case HKQuantityTypeIdentifier.waterTemperature.rawValue:
      return .degreeCelsius()
    case HKQuantityTypeIdentifier.underwaterDepth.rawValue:
      return .meter()
    default:
      return .count()
    }
  }

  private func categoryValueLabel(_ sample: HKCategorySample) -> String {
    if sample.categoryType.identifier == HKCategoryTypeIdentifier.sleepAnalysis.rawValue {
      switch sample.value {
      case HKCategoryValueSleepAnalysis.inBed.rawValue:
        return "在床上"
      case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue:
        return "睡眠"
      case HKCategoryValueSleepAnalysis.awake.rawValue:
        return "清醒"
      case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
        return "核心睡眠"
      case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
        return "深睡"
      case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
        return "REM"
      default:
        return "睡眠(\(sample.value))"
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
    switch use {
    case .yes: return "是"
    case .no: return "否"
    default: return "未设置"
    }
  }

  private func iso8601Now() -> String {
    iso8601Date(Date())
  }

  private func iso8601Date(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
}
