package org.amirite.galahad.app

import org.amirite.galahad.core.Json
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** The Inbox's list keys: each thing it shows has its own (a list given one key twice stops the app). */
class InboxTest {
    @Test
    fun aDeviceThatAskedTwiceIsTwoRequests() {
        // A phone whose first ask was left unanswered asks again with a new invite, and the node shows both.
        val first = Json.obj("invite" to "inv-1", "device" to "c_same", "sas" to "703369")
        val again = Json.obj("invite" to "inv-2", "device" to "c_same", "sas" to "694782")
        assertNotEquals(Inbox.pairingKey(first), Inbox.pairingKey(again))
    }
}
