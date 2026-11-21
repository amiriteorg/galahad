package org.amirite.galahad.app

import org.amirite.galahad.core.Ask
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.Roster
import org.amirite.galahad.core.Snapshot
import org.amirite.galahad.core.get
import org.amirite.galahad.core.list
import org.amirite.galahad.core.string
import org.amirite.galahad.core.text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The last Roundtable this phone saw, kept on it (the owner's word, 21 November 2026): drawn again as the node drew it,
 * with no more than the Roundtable shows, and never for another node or another key.
 */
class KeptTableTest {
    private val node = PairedNode("https://keep.example.test", "c_device-one", "Phone", "f_fleet", "keep", "camelot")
    private val team = Json.parse(
        """
        {"teammates":[{"id":"ada","name":"Ada","role":"engineer","instructions":"Never push to main; my bank PIN is not yours to know.","memory":"Working notes: the staging password rotates on Fridays.",
                       "keys":[{"name":"stripe-live"}],"acp":"goose acp","enabled":true,"dailyTurns":40,"turnsToday":3,"createdBy":"you","avatar":{"look":"gareth"},
                       "workspace":{"id":"0123456789","status":"running"}},
                      {"id":"bors","name":"Bors","role":"engineer","instructions":"","memory":"","enabled":false}],
         "rooms":[{"id":"r1","name":"Release room","direct":false,"members":["ada","bors"],"updatedAt":1763700000000,"paused":false}],
         "tasks":[{"id":"t1","title":"Sync survives a dropped connection","goal":"The whole brief, with the customer's address in it","assignee":"ada","status":"running","verified":false,
                   "updatedAt":1763700000000,"progress":"Running · bun test","changes":{"files":3,"patch":"diff --git a/secret.env"},"proposedBy":"gawain","room":"r1","dependsOn":["t0"]},
                  {"id":"t2","title":"The importer reads ISO dates","assignee":"bors","status":"failed","verified":false,"updatedAt":1763690000000,"error":"gave up"}],
         "deliveries":[{"id":"d1","teammate":"ada","status":"queued","updatedAt":1763700000000,"room":"r1","text":"a message's words"}],"removed":[{"id":"gone","name":"Gone"}],
         "seen":{"ada":1763690000000},"primary":"ada",
         "outcomes":[{"id":"o1","goal":"Something the Roundtable doesn't draw"}]}
        """.trimIndent(),
    )
    private val turns = Json.parse("""{"turns":[{"id":"u1","title":"Release notes","text":"words of a chat"}],"unread":[{"id":"c1","title":"The importer","preview":"his answer"}],"chats":"7"}""")
    private val asks = listOf(Ask("arm:team.ada", "forge", "post"))

    @Test fun drawsTheRoundtableAgainAsTheNodeDrewIt() {
        val kept = KeptTable.read(Json.parse(KeptTable.of(node, team, turns, asks, waiting = 3, at = 1_763_700_123_000).text()), node)!!
        val now = 1_763_700_200_000
        assertEquals(Roster.rows(Snapshot.of(team), asks, now), Roster.rows(Snapshot.of(kept.team), kept.asks, now))
        assertEquals(listOf("Release notes"), kept.turns)
        assertEquals(listOf("The importer"), kept.unread.map { it["title"].string })
        assertEquals(asks, kept.asks)
        assertEquals(3, kept.waiting)
        assertEquals(1_763_700_123_000, kept.at)
    }

    @Test fun keepsNoMoreThanTheRoundtableDraws() {
        val text = KeptTable.of(node, team, turns, asks, waiting = 3, at = 1).text()
        // A knight's standing instructions, what the team holds beyond the roster, a chat's words: none of it is kept.
        // A knight's instructions and working notes, the keys it may use, its agent's command, a task's brief and patch,
        // a message's words, what the team holds beyond the roster, a chat's words: none of it is kept.
        for (absent in listOf("instructions", "bank PIN", "memory", "staging password", "stripe-live", "goose acp", "the customer's address", "secret.env",
            "a message's words", "outcomes", "Something the Roundtable", "words of a chat", "his answer")) assertFalse(absent, text.contains(absent))
        val kept = KeptTable.read(Json.parse(text), node)!!
        assertEquals(listOf("teammates", "rooms", "tasks", "deliveries", "removed", "seen", "primary"), (kept.team as Json.Obj).fields.keys.toList())
        assertEquals(Snapshot.of(team), Snapshot.of(kept.team).copy(teammates = Snapshot.of(kept.team).teammates.map { it.copy(instructions = Snapshot.of(team).teammates.first { t -> t.id == it.id }.instructions) }))
        assertEquals(listOf("Ada", "Bors"), kept.team["teammates"].list.map { it["name"].string })
    }

    @Test fun isNeverDrawnForAnotherNodeAnotherKeyOrAnotherVersion() {
        val kept = Json.parse(KeptTable.of(node, team, turns, asks, waiting = 0, at = 1).text())
        assertNull(KeptTable.read(kept, node.copy(origin = "https://other.example.test")))
        assertNull(KeptTable.read(kept, node.copy(device = "c_device-two")))
        val fields = (kept as Json.Obj).fields
        assertNull(KeptTable.read(Json.Obj(fields + ("v" to Json.of(2))), node))
        assertNull(KeptTable.read(Json.Obj(fields - "team"), node))
        assertNull(KeptTable.read(Json.obj(), node))
    }
}
