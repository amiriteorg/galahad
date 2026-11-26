package org.amirite.galahad.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A task's words against the vectors' `timelines` section (the PWA's lib/task-card.ts over core's interventions.ts), as
 * the iPhone's TimelineTests holds its own. Run on the emulator (26 November 2026), Android's thread said "You stepped
 * in: again" and "takeover", the node's own keys, where the PWA and the iPhone say "given again" and "its desktop taken
 * over".
 */
class TaskWordsVectorsTest {
    private val t = Fixture.vectors["timelines"]!!
    private val tasks = t["tasks"].list.associate { it["id"].string!! to TeamTask.of(it) }

    @Test fun howYouSteppedInIsSaidAsThePwaSaysIt() {
        val cards = t["cards"].list
        assertTrue(cards.count { it["stepped"].string != null } >= 2)
        for (card in cards) {
            val id = card["id"].string!!
            assertEquals(id, card["stepped"].string, TaskWords.stepped(tasks.getValue(id)))
        }
    }
}
