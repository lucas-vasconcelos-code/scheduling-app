Pod::Spec.new do |s|
 s.name = 'AlignedAlarms'
 s.version = '1.0.0'
 s.summary = 'Context-aware meeting alarms for Aligned'
 s.description = s.summary
 s.license = { :type => 'MIT' }
 s.author = 'Aligned'
 s.homepage = 'https://example.com/aligned'
 s.platform = :ios, '16.4'
 s.source = { :git => '' }
 s.static_framework = true
 s.dependency 'ExpoModulesCore'
 s.source_files = '**/*.swift'
 s.swift_version = '5.9'
 s.weak_frameworks = 'AlarmKit'
end
