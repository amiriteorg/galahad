import Foundation

/*
 * Seating and keeping knights and rooms, as the PWA's forms do it (apps/web/src/views/team-forms.ts, lib/team.ts and
 * core's avatar.ts): a new knight's handle from its name, the look it is saved with, what removing one does, and the
 * shapes the node takes. The node checks everything again; these only say it here first, the PWA's way.
 */

/// `POST /api/team/teammates`: a knight as you save it (core's `TeammateInput`).
struct KnightInput: Encodable, Sendable, Equatable {
    var id: String
    var name: String
    var instructions: String
    /// Nil clears it: sent as null, never left out, so an emptied field is emptied on the node too.
    var repository: String?
    var harness: String
    var role: String
    /// Its own models, in order, in place of its role's; nil: its role's (sent as null). Sent only when `sendModels`:
    /// a node too old to know them would refuse the field.
    var models: [String]? = nil
    var sendModels = false
    var enabled: Bool
    var dailyTurns: Int
    /// The drawing it wears (`AvatarLook.profile`).
    var avatar: AvatarProfile

    enum CodingKeys: String, CodingKey { case id, name, instructions, repository, harness, role, models, enabled, dailyTurns, avatar }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(instructions, forKey: .instructions)
        try c.encode(repository, forKey: .repository)
        try c.encode(harness, forKey: .harness)
        try c.encode(role, forKey: .role)
        if sendModels { try c.encode(models, forKey: .models) }
        try c.encode(enabled, forKey: .enabled)
        try c.encode(dailyTurns, forKey: .dailyTurns)
        try c.encode(avatar, forKey: .avatar)
    }
}

/// A knight's look as the node saves it (core's `AvatarProfile`): the drawing's colour names the drawing.
struct AvatarProfile: Codable, Sendable, Equatable {
    var v = 1
    let form: String
    let color: String
    let accent: String
    var eyes = "oval"
    var accessory = "none"
    let temperament: String
}

/// `POST /api/team/rooms`: a room as you save it (core's `TeamRoomInput`); `id` and `direct` only when it exists.
struct RoomInput: Encodable, Sendable, Equatable {
    var id: String?
    var name: String
    var members: [String]
    var direct: Bool?
    var turnBudget: Int
}

/// `POST /api/team/arrange`: your order of the knights, and who leads the Roundtable (`galahad`, or a knight of yours),
/// core's `TeamArrangeInput`; what is unchanged is left out. The node answers with both, as it keeps them.
struct Arrangement: Codable, Sendable, Equatable {
    var order: [String]?
    var primary: String?
}

enum Knights {
    /// The harnesses a knight can work in, as they are named to you (the PWA's HARNESS), in its order.
    static let harnesses: [(id: String, name: String)] = [("native", "Galahad"), ("opencode", "OpenCode"), ("hermes", "Hermes Agent"), ("claude", "Claude Code"), ("codex", "Codex")]

    /// A roster role, as far as a knight's editor needs it (`forKnights` is absent from an older node).
    struct RoleInfo: Decodable, Sendable, Equatable {
        let models: [String]
        let forKnights: Bool?

        init(models: [String], forKnights: Bool?) {
            self.models = models
            self.forKnights = forKnights
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            models = try container.decodeIfPresent([String].self, forKey: .models) ?? []
            forKnights = try container.decodeIfPresent(Bool.self, forKey: .forKnights)
        }

        private enum CodingKeys: String, CodingKey { case models, forKnights }
    }

    private static let builtInRoles = ["engineer", "planner", "reviewer", "swift"]

    /// The roles a knight may be given, engineer first: the roster's that are for knights (the planner, engineer and swift
    /// roles, then yours by name; never the reviewer or a tool's), and the one it has now. An older node says nothing of
    /// which are for knights: then the usual four and every other. The PWA's `knightRoles`.
    static func roles(roster: [String: RoleInfo], current: String?) -> [String] {
        let told = roster.values.contains { $0.forKnights != nil }
        func theirs(_ role: String) -> Bool { !told || roster[role]?.forKnights == true }
        let builtIn = told ? ["engineer", "planner", "swift"].filter { $0 == "engineer" || theirs($0) } : builtInRoles
        let others = roster.keys.filter { !builtInRoles.contains($0) && theirs($0) }.sorted()
        var seen = Set<String>()
        return (builtIn + others + (current.map { [$0] } ?? [])).filter { seen.insert($0).inserted }
    }

    /// What a knight on this role works on, in a line (the PWA's `knightRoleLine`).
    static func roleLine(role: String, spec: RoleInfo?) -> String {
        guard let spec else { return "\(role) isn't on your roster: the engineer's models do its work" }
        if spec.forKnights == false { return "It talks on the \(role)'s models; its tasks' work runs on the engineer's, since the reviewer never does the work it checks" }
        guard let first = spec.models.first else { return "\(role) has no model yet: put one on it on the Models page" }
        let more = spec.models.count > 1 ? " (then \(spec.models.count - 1) more)" : ""
        return "Its work runs on \(first)\(more); its plan and the independent review stay the planner's and the reviewer's"
    }

    /// A model you may set a knight to work on (`GET /api/team/models`): its ref, and the nodes that serve it, when a local runtime does.
    struct ModelChoice: Decodable, Sendable, Hashable, Identifiable {
        let ref: String
        let on: [String]
        var id: String { ref }
    }

    /// The most models of its own a knight works on (core's `TeammateModels`).
    static let modelsMax = 8

    /// The models offered as toggles: the ones it works on first, in their order (one the node no longer offers
    /// included, so it can be turned off), then the rest as the node lists them (lib/team.ts' `knightModelChoices`).
    static func modelChoices(_ choices: [ModelChoice], own: [String] = []) -> [ModelChoice] {
        let byRef = Dictionary(choices.map { ($0.ref, $0) }, uniquingKeysWith: { first, _ in first })
        return own.map { byRef[$0] ?? ModelChoice(ref: $0, on: []) } + choices.filter { !own.contains($0.ref) }
    }

    /// Its own models with one turned on (last, as it is tried after the others; eight at most) or off (`toggleKnightModel`).
    static func toggle(_ own: [String], _ ref: String, on: Bool) -> [String] {
        if !on { return own.filter { $0 != ref } }
        return own.contains(ref) || own.count >= modelsMax ? own : own + [ref]
    }

    /// What a knight with models of its own works on, in a line; none: its role's (`knightModelsLine`).
    static func modelsLine(own: [String], role: String, spec: RoleInfo?) -> String {
        guard let first = own.first else { return "None chosen: it works on its role's models. \(roleLine(role: role, spec: spec))" }
        let more = own.count > 1 ? " (then \(own.count - 1) more, in the order you turned them on)" : ""
        return "Its work runs on \(first)\(more), in place of its role's; its plan and the independent review stay the planner's and the reviewer's"
    }

    /// What a knight works on, in a word or two: its role, and its own first model when it has some (`knightWorksOn`).
    static func worksOn(role: String, models: [String]?) -> String {
        guard let first = models?.first else { return role }
        let name = first.firstIndex(of: "/").map { String(first[first.index(after: $0)...]) } ?? first
        let more = (models?.count ?? 0) > 1 ? " +\((models?.count ?? 0) - 1)" : ""
        return "\(role) · on \(name)\(more)"
    }

    /// A new knight's handle, from its name: lowercase letters, digits and hyphens, never a reserved one or one taken
    /// (lib/team.ts' `teammateId`). It stays the same when the knight is renamed.
    static func handle(name: String, taken: [String]) -> String {
        let folded = String(String.UnicodeScalarView(name.decomposedStringWithCompatibilityMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        var cleaned = ""
        var dash = false
        for scalar in folded.lowercased().unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                cleaned.unicodeScalars.append(scalar)
                dash = false
            } else if !dash {
                cleaned += "-"
                dash = true
            }
        }
        cleaned = String(cleaned.drop { $0 == "-" }.reversed().drop { $0 == "-" }.reversed())
        let start = cleaned.first.map { ("a"..."z").contains($0) } == true ? cleaned : "knight-\(cleaned)"
        var base = String(start.prefix(28))
        while base.hasSuffix("-") { base.removeLast() }
        if base.isEmpty { base = "knight" }
        let used = Set(taken + ["owner", "system", "galahad"])
        if !used.contains(base) { return base }
        var suffix = 2
        while used.contains("\(base)-\(suffix)") { suffix += 1 }
        return "\(base)-\(suffix)"
    }

    /// A handle as the node takes one: a lowercase letter, then at most 31 lowercase letters, digits or hyphens.
    static func isHandle(_ text: String) -> Bool { text.wholeMatch(of: #/[a-z][a-z0-9\-]{0,31}/#) != nil }

    /// What removing a knight does, said before you do it, and whether its VM goes with it (lib/team.ts' `removalPlan`).
    /// `blocked`: why this device can't (a knight with a VM goes only with it, which takes a device that may manage sandboxes).
    struct Removal: Equatable, Sendable {
        let blocked: String?
        let lines: [String]
        let destroyWorkspace: Bool
    }

    static func removal(id: String, name: String, workspace: Bool, workspaceNode: Bool, maySandbox: Bool) -> Removal {
        let lines = [
            "\(name) leaves every room and does no more work. What \(name) said stays where it was said, and its direct conversations are kept.",
            "The handle \(id) is never used again, so nothing new inherits its history.",
        ]
        if !workspace && !workspaceNode { return Removal(blocked: nil, lines: lines + ["This can't be undone."], destroyWorkspace: false) }
        if !maySandbox { return Removal(blocked: "\(name) has a VM, and removing \(name) destroys it. That takes a device that may manage sandboxes; this one may not.", lines: lines, destroyWorkspace: true) }
        let vm = workspace ? "\(name)'s VM is destroyed with it, and everything in its /work." : "A VM was being made for \(name): if there is one, it is destroyed with it, and everything in its /work."
        return Removal(blocked: nil, lines: lines + ["\(vm) This can't be undone."], destroyWorkspace: true)
    }
}

extension AvatarLook {
    /// Each drawing's helmet shape and its accent (core's `AVATAR_LOOKS` and `matchingAccent`), for saving a look.
    private static let saved: [String: (form: String, accent: String)] = [
        "kay": ("hooded", "#dab188"), "gaheris": ("armored", "#4a2b2d"), "percival": ("armored", "#a46d91"),
        "palamedes": ("armored", "#493237"), "gawain": ("round", "#404032"), "tristan": ("armored", "#636371"),
        "lancelot": ("armored", "#5c6a87"), "bedivere": ("armored", "#667367"), "bors": ("round", "#6b4536"),
        "gareth": ("round", "#cb9226"),
    ]

    /// The drawings' names, as they were drawn (core's `AVATAR_LOOKS`).
    static func title(_ look: String) -> String { look.prefix(1).uppercased() + look.dropFirst() }

    /// A look as the node saves it (core's `lookProfile`): the drawing's colour names it.
    static func profile(look: String, temperament: String) -> AvatarProfile {
        let chosen = looks.first { $0.id == look } ?? looks[0]
        let kept = saved[chosen.id] ?? ("armored", chosen.color)
        return AvatarProfile(form: kept.form, color: chosen.color, accent: kept.accent, temperament: temperament)
    }

    /// How lively a knight is at rest: its saved profile's word, else the one its handle seeds (core's `resolveAvatar`).
    static func temperament(id: String, profile: JSONValue?) -> String {
        if savedColor(profile) != nil, case .object(let p)? = profile, case .string(let word)? = p["temperament"] { return word }
        // core's defaultAvatar: the handle's seed, then one draw each for palette, form, eyes and headwear before this one.
        var seed: UInt32 = 2_166_136_261
        for unit in id.utf16 { seed = (seed ^ UInt32(unit)) &* 16_777_619 }
        let next = { (count: UInt32) -> UInt32 in seed = seed &* 1_664_525 &+ 1_013_904_223; return seed % count }
        _ = (next(8), next(3), next(3), next(4))
        return ["calm", "curious", "lively"][Int(next(3))]
    }
}
