package org.amirite.galahad.core

/*
 * Connectors as the node lists them (`GET /api/connectors`, core's ConnectorView) and as the PWA (lib/connector-state.ts)
 * and the Apple app (Core/Connectors.swift) say where each one's key stands: a key's words for most, a sign-in's for one
 * that signs in as you. The parity vectors' `connectorStates` hold the words and tones answer for answer.
 */

/** A connector the node knows: installed, or in its catalog to add. */
data class Connector(
    val id: String,
    val label: String,
    val description: String?,
    val kind: String,
    /** An MCP server's address (null for the others). */
    val url: String?,
    val installed: Boolean,
    /** none-needed · ready · missing · optional-missing · signed-out · wrong-origin */
    val key: String,
    /** The vault secret its key is sealed under. */
    val secret: String?,
    val keyHelp: String?,
    val needsOrigin: Boolean,
    val problem: String?,
    val tools: List<Tool>,
    /** Galahad's alone, and the agents you let use it, by label (null: the node says nothing). */
    val allowed: List<String>?,
    /** Whose sign-in it uses (google, microsoft, mcp) and whose account it is signed in to; null for one with a key. */
    val signIn: String?,
    val account: String?,
    /** What it reads stays in the answer that read it (mail), as the bank's data does. */
    val private: Boolean,
) {
    /** A tool: its name, what it does, its class (read · create · modify · outward · delete), and whether it asks you first. */
    data class Tool(val name: String, val description: String, val kind: String, val asks: Boolean)

    companion object {
        fun of(j: Json) = Connector(
            j["id"].string ?: "", j["label"].string ?: "", j["description"].string, j["kind"].string ?: "", j["url"].string,
            j["installed"].bool ?: false, j["key"].string ?: "", j["secret"].string, j["keyHelp"].string, j["needsOrigin"].bool ?: false,
            j["problem"].string,
            j["tools"].list.map { Tool(it["name"].string ?: "", it["description"].string ?: "", it["class"].string ?: "", it["asks"].bool ?: false) },
            j["access"].takeIf { it is Json.Obj }?.let { a -> a["allowed"].list.mapNotNull { it.string } },
            j["oauth"].takeIf { it is Json.Obj }?.get("provider").string,
            j["oauth"].takeIf { it is Json.Obj }?.get("account").string,
            j["private"].bool ?: false,
        )
    }
}

object Connectors {
    data class State(val label: String, val tone: String)

    /** A key's state in words, its tone, and what it means (connector-state.ts' KEY_STATE). */
    val keyState: Map<String, Pair<State, String>> = mapOf(
        "none-needed" to (State("no key needed", "neutral") to "It works without a key."),
        "ready" to (State("key sealed", "ok") to "Its key is sealed in the vault and only ever sent to this origin."),
        "missing" to (State("needs a key", "warn") to "It can't do anything until its key is in the vault."),
        "optional-missing" to (State("public only", "neutral") to "Public reads work without a key, at a lower rate limit. Add one to reach your own data."),
        "signed-out" to (State("not signed in", "warn") to "Its app is sealed: sign in as yourself to use it."),
        "wrong-origin" to (State("key pinned elsewhere", "danger") to "The vault holds a key under this name, but it's pinned to another origin, so it's never sent here. Replace it with one entered for this connector."),
    )

    /** A sign-in's state in words, for a connector that signs in as you (connector-state.ts' OAUTH_STATE). */
    private val oauthState: Map<String, State> = mapOf(
        "missing" to State("needs your app", "warn"),
        "signed-out" to State("not signed in", "warn"),
        "ready" to State("signed in", "ok"),
        "wrong-origin" to State("pinned elsewhere", "danger"),
    )

    /** A hosted MCP server's sign-in: no app of yours, so until you sign in it is just not signed in. */
    private val mcpState: Map<String, State> = oauthState + ("missing" to State("not signed in", "warn"))

    /** A connector's badge (connector-state.ts' `connectorState`): `signIn` is whose sign-in it uses, null for one with a key. */
    fun state(key: String, signIn: String?): State? {
        if (signIn != null) (if (signIn == "mcp") mcpState else oauthState)[key]?.let { return it }
        return keyState[key]?.first
    }

    /** Where Google (or an MCP server) sends you back: the app's own address on the node (views/sign-in.ts' `callbackUrl`). */
    fun callback(origin: String): String = "${origin.removeSuffix("/")}/oauth/callback"

    /** The class of a tool, as a person reads it. */
    fun classLine(tool: Connector.Tool): String = if (tool.asks) "${tool.kind} · asks you first" else tool.kind
}

/** A server of the MCP library, as the node lists it (core McpLibraryView). */
data class LibraryEntry(
    val id: String,
    val label: String,
    val description: String,
    val url: String,
    val site: String,
    val category: String,
    /** oauth · key · none */
    val auth: String,
    val reviewed: Boolean,
    val installed: Boolean,
) {
    companion object {
        fun of(j: Json) = LibraryEntry(
            j["id"].string ?: "", j["label"].string ?: "", j["description"].string ?: "", j["url"].string ?: "", j["site"].string ?: "",
            j["category"].string ?: "", j["auth"].string ?: "", j["reviewed"].bool ?: false, j["installed"].bool ?: false,
        )
    }
}

/** A page of the library (core ConnectorLibraryView): its entries, how many in all, its shelves, and where its index stands. */
data class LibraryPage(val entries: List<LibraryEntry>, val total: Int, val shelves: List<Pair<String, Int>>, val index: Index) {
    data class Index(val url: String?, val fetched: Double?, val count: Int, val problem: String?)

    companion object {
        fun of(j: Json) = LibraryPage(
            j["entries"].list.map(LibraryEntry::of),
            j["total"].int ?: 0,
            j["categories"].list.mapNotNull { c -> c["name"].string?.let { it to (c["count"].int ?: 0) } },
            j["index"].let { Index(it["url"].string, it["fetched"].double, it["count"].int ?: 0, it["problem"].string) },
        )
    }
}

/** How a library server lets Galahad in, in words (the PWA's views/mcp-library.ts HOW). */
fun libraryHow(auth: String): String = when (auth) {
    "oauth" -> "Signs in"
    "key" -> "Takes a key"
    else -> "Open"
}

/** Under the library's list: how many, and where they come from (the Apple app's `libraryLine`). */
fun libraryLine(page: LibraryPage, shown: Int): String {
    val head = "${"%,d".format(page.total)} ${if (page.total == 1) "server" else "servers"}${if (page.total > shown) ", $shown shown" else ""}."
    page.index.problem?.let { return "$head The index couldn't be read ($it): Galahad's reviewed servers are here." }
    if (page.index.fetched != null) return "$head Galahad's reviewed servers, and ${"%,d".format(page.index.count)} more the index found in the official MCP Registry, each the service's own."
    return if (page.index.url == null) "$head Galahad's reviewed servers (this node reads no index)." else "$head Reading the index for the first time…"
}
