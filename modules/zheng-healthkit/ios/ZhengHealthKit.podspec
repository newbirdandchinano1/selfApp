require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ZhengHealthKit'
  s.version        = package['version']
  s.summary        = 'Apple HealthKit bridge for Zheng app'
  s.description    = 'Reads HealthKit data for profile screen'
  s.license        = 'MIT'
  s.author         = 'Zheng'
  s.homepage       = 'https://github.com/expo/expo'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'HealthKit'
end
