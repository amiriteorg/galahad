package org.amirite.galahad.app

import org.amirite.galahad.core.Ask
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.get
import org.amirite.galahad.core.int
import org.amirite.galahad.core.list
import org.amirite.galahad.core.long
import org.amirite.galahad.core.string

/**
 * The last Roundtable this phone saw, kept on it by the owner's word (21 November 2026): drawn the moment the app opens,
 * and replaced by the node's first answer, so a slow connection doesn't open on an empty table. The iPhone app keeps
 * nothing; this keeps what the Roundtable draws and no more: the team as the node said it, in the fields its roster reads
 * (a knight's instructions and notes, a task's brief, left out), the chats' titles, which approvals wait (who asks and
 * for which tool, never what a request holds) and how many things wait for you. Only for the node and key it came from.
 */
object KeptTable {
    private const val VERSION = 1

    /** What of GET /api/team the roster reads (core/Roster.kt's Snapshot.of). */
    private val TEAM = listOf("teammates", "rooms", "tasks", "deliveries", "removed", "seen", "primary")

    /**
     * Of each list, the fields the roster and the work's rows read (Teammate.of, Room.of, Job.task, Job.delivery, TeamTask.of
     * for a row) and no others: a knight's standing instructions, its working notes, the keys it may use, a task's whole
     * brief are not the Roundtable's. (A knight's repository names its tasks' project; a task's start says how long it has
     * been at work; a shipped task keeps its pull request's number.)
     */
    private val FIELDS = mapOf(
        "teammates" to setOf("id", "name", "role", "enabled", "dailyTurns", "turnsToday", "createdBy", "avatar", "workspace", "repository"),
        "rooms" to setOf("id", "name", "direct", "members", "updatedAt", "paused"),
        "tasks" to setOf("id", "title", "assignee", "status", "verified", "createdAt", "updatedAt", "progress", "error", "changes", "proposedBy", "room", "dependsOn", "shipped"),
        "deliveries" to setOf("id", "teammate", "status", "updatedAt", "error", "room"),
        "removed" to setOf("id", "name"),
    )

    /** What is kept, as it was said: the node it came from, when, and what the Roundtable draws. */
    data class Kept(val team: Json, val turns: List<String?>, val unread: List<Json>, val asks: List<Ask>, val waiting: Int, val at: Long)

    /** The record kept for [node], from what the node last said. */
    fun of(node: PairedNode, team: Json, turns: Json?, asks: List<Ask>, waiting: Int, at: Long): Json = Json.obj(
        "v" to VERSION,
        "origin" to node.origin,
        "device" to node.device,
        "at" to at,
        "team" to trimmed(team),
        // (A temporary chat has no title: kept as one, so his line still says he is working in it.)
        "turns" to (turns?.get("turns")?.list?.map { it["title"].string } ?: emptyList<String?>()),
        "unread" to (turns?.get("unread")?.list?.mapNotNull { it["title"].string }?.map { Json.obj("title" to it) } ?: emptyList<Json>()),
        "asks" to asks.map { Json.obj("by" to it.by, "connector" to it.connector, "tool" to it.tool) },
        "waiting" to waiting,
    )

    /** What was kept, if it is [node]'s, made with this key, in this version; anything else is nothing. */
    fun read(kept: Json, node: PairedNode): Kept? {
        if (kept["v"].int != VERSION || kept["origin"].string != node.origin || kept["device"].string != node.device) return null
        val team = kept["team"]?.takeIf { it is Json.Obj } ?: return null
        return Kept(
            team = team,
            turns = kept["turns"].list.map { it.string },
            unread = kept["unread"].list,
            asks = kept["asks"].list.map { Ask(it["by"].string ?: "", it["connector"].string, it["tool"].string) },
            waiting = kept["waiting"].int ?: 0,
            at = kept["at"].long ?: 0,
        )
    }

    /** The team as the roster reads it, and no more. */
    private fun trimmed(team: Json): Json {
        val fields = (team as? Json.Obj)?.fields ?: return Json.obj()
        val kept = LinkedHashMap<String, Json>()
        for (name in TEAM) {
            val value = fields[name] ?: continue
            val allowed = FIELDS[name]
            // (A list that isn't one is left out, never kept whole.)
            if (allowed == null) kept[name] = value
            else if (value is Json.Arr) kept[name] = Json.Arr(value.items.mapNotNull { item -> (item as? Json.Obj)?.let { only(it, allowed) } })
        }
        return Json.Obj(kept)
    }

    /** An item with the fields it may keep (a task's changes: how many files, nothing of what they were; its pull request:
     * its number, not where it is). */
    private fun only(item: Json.Obj, allowed: Set<String>): Json.Obj = Json.Obj(
        item.fields.filterKeys { it in allowed }.mapValues { (key, value) ->
            when {
                key == "changes" && value is Json.Obj -> Json.Obj(value.fields.filterKeys { it == "files" })
                key == "shipped" && value is Json.Obj -> Json.Obj(value.fields.filterKeys { it == "pr" })
                else -> value
            }
        },
    )
}
