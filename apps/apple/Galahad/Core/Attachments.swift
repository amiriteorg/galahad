import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A file kept on the node for a message of yours (core's `AttachmentRef`): what the message names it by.
struct AttachmentRef: Codable, Hashable, Sendable {
    /// The SHA-256 of its bytes, in hex.
    let id: String
    let name: String
    /// image/png · image/jpeg · image/webp · image/gif · text/plain
    let type: String
    let bytes: Int

    var isPicture: Bool { type != "text/plain" }
}

/**
 * Files with a message, on this side (the node keeps them: packages/node/src/uploads.ts; the PWA's lib/attachments.ts).
 * What a file is, is read from its bytes by the node's own rule (packages/core/src/attachments.ts), never from its
 * name. A picture is drawn again before it goes, at most `side` pixels on its long side, as a new image: its metadata
 * (where a photo was taken, the camera) is never copied into it. A GIF goes as it is; anything else must be text.
 */
enum Attachments {
    /// core's ATTACHMENT_LIMITS.
    static let perMessage = 8
    static let pictureBytes = 5 * 1024 * 1024
    static let textBytes = 256 * 1024
    /// A picture's long side, at most: what Claude scales a picture down to anyway, so more would only cost more.
    static let side = 1568

    /// What a picture is by its first bytes (each format's own signature), or nil when it is none of the four.
    static func pictureType(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(12))
        func starts(_ sig: [UInt8]) -> Bool { b.count >= sig.count && Array(b.prefix(sig.count)) == sig }
        if starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
        if starts([0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if starts([0x47, 0x49, 0x46, 0x38]), b.count >= 6, b[4] == 0x37 || b[4] == 0x39, b[5] == 0x61 { return "image/gif" }
        if starts([0x52, 0x49, 0x46, 0x46]), b.count >= 12, b[8] == 0x57, b[9] == 0x45, b[10] == 0x42, b[11] == 0x50 { return "image/webp" }
        return nil
    }

    /// Whether these bytes are text: UTF-8, with no NUL.
    static func isText(_ data: Data) -> Bool {
        !data.contains(0) && String(data: data, encoding: .utf8) != nil
    }

    /// A file's name as the node takes it: no folders, no control characters, at most 200 characters.
    static func name(_ raw: String) -> String {
        let last = raw.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        let clean = String(last.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F }).trimmingCharacters(in: .whitespaces)
        return clean.isEmpty ? "file" : String(clean.prefix(200))
    }

    /// A file ready to go up: its name, what its bytes are, and the bytes.
    struct Prepared: Sendable, Equatable {
        let name: String
        let type: String
        let data: Data
    }

    struct Refused: LocalizedError, Equatable {
        let errorDescription: String?
    }

    /// Why a file can't go with a message, in words; nil when it can.
    static func refusal(name: String, type: String?, size: Int) -> String? {
        guard let type else { return "\(name) isn't a picture or text: only those go with a message." }
        if size == 0 { return "\(name) is empty." }
        let text = type == "text/plain"
        let limit = text ? textBytes : pictureBytes
        return size > limit ? "\(name) is too big: \(text ? "a text goes with a message up to 256 KB" : "a picture goes with a message up to 5 MB")." : nil
    }

    /// A file you chose (a photo, a picture, a text), made ready to go up, or why it can't.
    static func prepare(name raw: String, data: Data) throws -> Prepared {
        let name = name(raw)
        let was = pictureType(data)
        // A GIF goes as it is: drawn again, it would lose its frames.
        if was == "image/gif" {
            if let why = refusal(name: name, type: was, size: data.count) { throw Refused(errorDescription: why) }
            return Prepared(name: name, type: "image/gif", data: data)
        }
        // A picture of the four, or one ImageIO reads that isn't (a HEIC from the camera), is drawn again.
        if was != nil || (!isText(data) && readable(data)) {
            guard let redrawn = redraw(data, keepPNG: was == "image/png") else { throw Refused(errorDescription: "\(name) is a picture this app can't read: save it as a JPEG or PNG first.") }
            if let why = refusal(name: name, type: redrawn.type, size: redrawn.data.count) { throw Refused(errorDescription: why) }
            return Prepared(name: redrawn.type == "image/jpeg" ? jpegName(name) : name, type: redrawn.type, data: redrawn.data)
        }
        if let why = refusal(name: name, type: isText(data) ? "text/plain" : nil, size: data.count) { throw Refused(errorDescription: why) }
        return Prepared(name: name, type: "text/plain", data: data)
    }

    /// Whether ImageIO reads these bytes as a picture of some kind.
    static func readable(_ data: Data) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return false }
        return CGImageSourceGetType(source) != nil && CGImageSourceGetCount(source) > 0
    }

    /// The name of a picture drawn again as a JPEG: its own, ending in .jpg.
    static func jpegName(_ name: String) -> String {
        "\(name.replacing(#/\.(png|webp|heic|heif|jpe?g|tiff?|bmp|avif)$/#.ignoresCase(), with: "")).jpg"
    }

    /// A picture drawn again at most `side` pixels on its long side, upright, as a new image with none of the old one's
    /// metadata: a PNG (where it was one and still fits) or a JPEG.
    static func redraw(_ data: Data, keepPNG: Bool) -> (data: Data, type: String)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: side,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        func encoded(_ type: UTType, quality: Double?) -> Data? {
            let out = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { return nil }
            // Only how it is compressed: nothing of the photo's own properties is handed over.
            CGImageDestinationAddImage(destination, image, quality.map { [kCGImageDestinationLossyCompressionQuality: $0] as CFDictionary })
            return CGImageDestinationFinalize(destination) ? out as Data : nil
        }
        if keepPNG, let png = encoded(.png, quality: nil), png.count <= pictureBytes { return (png, "image/png") }
        return encoded(.jpeg, quality: 0.86).map { ($0, "image/jpeg") }
    }
}
