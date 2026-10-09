import Foundation
import AVFoundation
import Speech

@main
struct TranscribeAudio {
    static func main() async throws {
        guard CommandLine.arguments.count > 1 else { return }
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let audioFile = try AVAudioFile(forReading: url)
        let transcriber = SpeechTranscriber(
            locale: Locale(identifier: "el-GR"),
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: [.audioTimeRange]
        )
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
        for try await result in transcriber.results {
            print(result.text)
        }
    }
}
