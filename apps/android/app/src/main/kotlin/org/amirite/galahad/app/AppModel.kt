package org.amirite.galahad.app

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.amirite.galahad.core.Ask
import org.amirite.galahad.core.DeviceKey
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.NodeClient
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Roster
import org.amirite.galahad.core.RosterRow
import org.amirite.galahad.core.Snapshot
import org.amirite.galahad.core.get
import org.amirite.galahad.core.list
import org.amirite.galahad.core.string
import org.amirite.galahad.core.text

/** The node this phone is paired with (kept as the Apple app keeps its PairedNode, outside any backup). */
data class PairedNode(val origin: String, val device: String, val name: String, val fleet: String, val nodeName: String?, val fleetName: String?) {
    fun json(): Json = Json.obj("origin" to origin, "device" to device, "name" to name, "fleet" to fleet, "nodeName" to nodeName, "fleetName" to fleetName)

    companion object {
        fun of(j: Json): PairedNode? {
            return PairedNode(
                j["origin"].string ?: return null, j["device"].string ?: return null, j["name"].string ?: return null,
                j["fleet"].string ?: return null, j["nodeName"].string, j["fleetName"].string,
            )
        }
    }
}

/** What the Inbox holds: what only you can answer. */
data class Inbox(
    val actions: List<Json> = emptyList(),
    val questions: List<Json> = emptyList(),
    val keys: List<Json> = emptyList(),
    val pairings: List<Json> = emptyList(),
) {
    val count: Int get() = actions.size + questions.size + keys.size + pairings.size

    companion object {
        /**
         * A device asking to join, as the Inbox's list tells one apart from another: by its invite and its key together,
         * since one device may ask again with a new invite while its first ask still waits.
         */
        fun pairingKey(p: Json): String = "p:${p["invite"].string}:${p["device"].string}"
    }
}

/** The Roundtable as this phone last read it. */
data class Table(
    val snapshot: Snapshot? = null,
    val rows: List<RosterRow> = emptyList(),
    val galahad: Roster.Now = Roster.galahadNow(turns = emptyList(), quests = emptyList(), needs = null),
    /** Chats with an answer you haven't read, newest first. */
    val unread: List<Json> = emptyList(),
    /** Which writing of the chats the node said last (`chats` on GET /api/turns): when it moves, an open chat is read again. */
    val chats: String? = null,
)

/**
 * The app's state, one for the process (a rotation or a new window keeps it): the pairing, the device key, and what the
 * node last said. While the app is on screen it asks the node every five seconds and after every answer of yours, as
 * the Apple app does; off screen it asks nothing (Android would stop it anyway, and the battery is yours).
 */
class AppModel(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = context.getSharedPreferences("galahad", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _paired = MutableStateFlow(load())
    val paired: StateFlow<PairedNode?> = _paired.asStateFlow()

    private val _table = MutableStateFlow(Table())
    val table: StateFlow<Table> = _table.asStateFlow()

    private val _inbox = MutableStateFlow(Inbox())
    val inbox: StateFlow<Inbox> = _inbox.asStateFlow()

    /** The last thing that went wrong asking the node (null: the last ask was answered). */
    private val _problem = MutableStateFlow<NodeError?>(null)
    val problem: StateFlow<NodeError?> = _problem.asStateFlow()

    /** An invite handed over by a `galahad:` link or a share, to join with. */
    val handed = MutableStateFlow<String?>(null)

    /** Where a tapped notification opens: its place (core's NotifyOpen) and a kept chat. */
    val opening = MutableStateFlow<Pair<String, String?>?>(null)

    /** The app is on screen (its activity started): what asks the node again and again asks only then. */
    val front = MutableStateFlow(false)

    /** Something shared from another app, for a new chat's message box: its words, and pictures to attach. */
    data class Shared(val words: String?, val pictures: List<android.net.Uri>)

    val shared = MutableStateFlow<Shared?>(null)

    val chat = ChatModel(this)

    var client: NodeClient? = null
        private set

    init {
        connect()
    }

    /** Paired only while the key that paired is still this phone's (a reinstall forgets the Keystore's key). */
    private fun load(): PairedNode? {
        val stored = prefs.getString("paired-node", null)?.let { runCatching { PairedNode.of(Json.parse(it)) }.getOrNull() } ?: return null
        val key = runCatching { DeviceKey.load() }.getOrNull() ?: return null
        return stored.takeIf { it.device == key.device }
    }

    private fun connect() {
        val node = _paired.value
        client = if (node != null) runCatching { DeviceKey.load() }.getOrNull()?.let { NodeClient(node.origin, it) } else null
    }

    fun paired(node: PairedNode) {
        prefs.edit().putString("paired-node", node.json().text()).apply()
        _paired.value = node
        connect()
        scope.launch { refresh() }
    }

    /** Forget the node here: the key goes too, so this phone's old id is no longer anyone's. */
    fun forget() {
        Notices.stop(appContext)
        UnifiedPush.unregister(appContext)
        prefs.edit().remove("paired-node").apply()
        runCatching { DeviceKey.forget() }
        _paired.value = null
        client = null
        _table.value = Table()
        _inbox.value = Inbox()
        chat.reset()
    }

    /**
     * The app has come to the front: what the node kept for this phone's notifications is taken and dropped (the app
     * shows it all), and this phone stops asking if they were turned off elsewhere.
     */
    suspend fun inFront() {
        val c = client ?: return
        if (!Notices.on(appContext)) return
        if (runCatching { Notices.collect(appContext, c, show = false) }.getOrNull() == false) Notices.stop(appContext)
    }

    /** Asks every five seconds while [active] runs (the activity's STARTED state). */
    suspend fun poll() {
        while (true) {
            refresh()
            delay(5_000)
        }
    }

    /** One look at everything the screens show, the asks in parallel; one that fails leaves what it had. */
    suspend fun refresh() {
        val c = client ?: return
        coroutineScope {
            val team = async { attempt { c.get("/api/team") } }
            val actions = async { attempt { c.get("/api/actions") } }
            val questions = async { attempt { c.get("/api/questions") } }
            val keys = async { attempt { c.get("/api/secret-requests") } }
            val pairings = async { attempt { c.get("/api/pairings") } }
            val turns = async { attempt { c.get("/api/turns") } }
            val got = listOf(team, actions, questions, keys, pairings, turns).map { it.await() }
            val failure = got.firstNotNullOfOrNull { it.exceptionOrNull() as? NodeError }
            _problem.value = if (got[0].isSuccess) null else failure

            val inbox = Inbox(
                actions = got[1].getOrNull()?.let { j -> j["actions"].list.filter { it["state"].string == "waiting" } } ?: _inbox.value.actions,
                questions = got[2].getOrNull()?.let { it["questions"].list } ?: _inbox.value.questions,
                keys = got[3].getOrNull()?.let { it["requests"].list } ?: _inbox.value.keys,
                pairings = got[4].getOrNull()?.let { it["pairings"].list } ?: _inbox.value.pairings,
            )
            _inbox.value = inbox
            val turnsJson = got[5].getOrNull()
            val snapshot = got[0].getOrNull()?.let(Snapshot::of) ?: _table.value.snapshot
            val asks = inbox.actions.map { Ask(it["by"].string ?: "", it["connector"].string, it["tool"].string) }
            val now = System.currentTimeMillis()
            val rows = snapshot?.let { Roster.rows(it, asks, now) } ?: emptyList()
            val knights = snapshot?.teammates?.map { it.id } ?: emptyList()
            val turnList = turnsJson?.let { it["turns"].list } ?: emptyList()
            val unread = turnsJson?.let { it["unread"].list } ?: _table.value.unread
            val needs = Roster.galahadNeeds(inbox.count, asks, knights)
            val galahad = Roster.galahadNow(
                turns = turnList.map { it["title"].string },
                quests = emptyList(),
                needs = needs,
                unread = unread.map { it["title"].string },
            )
            _table.value = Table(snapshot, rows, galahad, unread, turnsJson?.get("chats")?.text() ?: _table.value.chats)
        }
        chat.follow(_table.value.chats)
    }

    private suspend fun <T> attempt(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: NodeError) {
        Result.failure(e)
    }

    /** Your answer to an approval: the first decision stands, and no answer before it expires means no. */
    suspend fun decide(action: String, approve: Boolean, note: String? = null) {
        client?.post("/api/actions/decide", Json.obj("id" to action, "approve" to approve, "note" to note?.ifBlank { null }))
        refresh()
    }

    /** A key sealed in the vault for what asked for it: the value goes to the node once, and is never shown again. */
    suspend fun sealKey(name: String, value: String, provider: String?) {
        client?.post("/api/secrets", Json.obj("name" to name, "value" to value, "provider" to provider))
        refresh()
    }

    suspend fun dismissKey(name: String) {
        client?.post("/api/secret-requests/dismiss", Json.obj("name" to name))
        refresh()
    }

    suspend fun answerQuestion(id: String, accept: Boolean, content: Map<String, Any?> = emptyMap()) {
        client?.post("/api/questions/answer", Json.obj("id" to id, "accept" to accept, "content" to if (accept) Json.of(content.filterValues { it != null }) else null))
        refresh()
    }

    /** Another device asking to join: yours to let in, once its code matches the one it shows. */
    suspend fun answerPairing(invite: String, device: String, approve: Boolean) {
        client?.post(if (approve) "/api/pairings/approve" else "/api/pairings/reject", Json.obj("invite" to invite, "device" to device))
        refresh()
    }

    /** What happened since you last looked (no model: the node's own record), and that you've now seen it. */
    suspend fun away(): List<Json> {
        val c = client ?: return emptyList()
        val since = prefs.getLong("away-since", System.currentTimeMillis() - 24 * 3_600_000L)
        val lines = runCatching { c.post("/api/away", Json.obj("since" to since))["lines"].list }.getOrNull() ?: return emptyList()
        return lines
    }

    fun sawAway() = prefs.edit().putLong("away-since", System.currentTimeMillis()).apply()

    /** How many the Inbox holds, as its tab's badge counts them. */
    val inboxCount: Int get() = _inbox.value.count

    fun launch(block: suspend CoroutineScope.() -> Unit) = scope.launch(block = block)

    companion object {
        @Volatile private var instance: AppModel? = null

        fun of(context: Context): AppModel = instance ?: synchronized(this) { instance ?: AppModel(context.applicationContext).also { instance = it } }

        /** A number of anything, as a badge says it. */
        fun badge(n: Int): String = if (n > 99) "99+" else n.toString()

    }
}
