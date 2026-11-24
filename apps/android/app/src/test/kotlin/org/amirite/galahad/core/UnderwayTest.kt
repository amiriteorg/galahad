package org.amirite.galahad.core

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** What is under way in a chat, in words: the PWA's lib/underway.ts, word for word (apps/web/src/lib/underway.test.ts). */
class UnderwayTest {
    private val copenhagen = ZoneId.of("Europe/Copenhagen")
    /** 24 November 2026, 20:07:31 UTC: 21:07 in Copenhagen. */
    private val now = 1_795_550_851_000L

    @Test
    fun aTimeIsTheTimeOfDayTodayWithItsDayOnAnother() {
        assertEquals("23:07", UnderwayWords.whenWords(now + 2 * 3_600_000, now, copenhagen))
        assertEquals("Wed 25 Nov, 09:00", UnderwayWords.whenWords(1_795_593_600_000L, now, copenhagen))
    }

    @Test
    fun aTaskSaysHowItStands() {
        assertEquals("at work", UnderwayWords.state(UnderwayTask("t", "x", "gareth", "Gareth", "running", "", "r")))
        assertEquals("12 commands · running bun test", UnderwayWords.state(UnderwayTask("t", "x", "gareth", "Gareth", "running", "12 commands · running bun test\nmore", "r")))
        assertEquals("waiting its turn", UnderwayWords.state(UnderwayTask("t", "x", "ada", "Ada", "queued", "", "r")))
    }

    @Test
    fun aLookSaysWhenAndWhatAtAndComeBackIsHisOwnNote() {
        assertEquals("Looking again at 23:07: Is the site live?", UnderwayWords.look(UnderwayLook("lk_AAAAAAAAAAAAAAAA", now + 2 * 3_600_000, "Is the site live?"), now, copenhagen))
        assertEquals("He looked again, as he said at 21:07 he would: Is the site live?", UnderwayWords.looked(LookNote(now, "Is the site live?"), now + 3_600_000, copenhagen))
    }

    @Test
    fun theNodesAnswerIsReadLeniently() {
        val json = Json.parse("""{"tasks":[{"id":"task-1","title":"T","assignee":"gareth","name":"Gareth","status":"running","progress":"","room":"room-1"},{"title":"no id"}],"looks":[{"id":"lk_AAAAAAAAAAAAAAAA","at":1795558051000,"note":"N"}]}""")
        val view = Underway.of(json)
        assertEquals(listOf("Gareth"), view.tasks.map { it.name })
        assertEquals(listOf("N"), view.looks.map { it.note })
        assertFalse(view.isEmpty)
    }
}
