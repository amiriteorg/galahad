package org.amirite.galahad.core

import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A node that can't be reached is said so in words: never the network library's own text, which names its classes and
 * objects ("unexpected end of stream on com.android.okhttp.Address@fd1bb28f" reached the screen once).
 */
class NodeClientTest {
    private val signer = object : Signer {
        override val device = "c_" + "A".repeat(87)
        override fun sign(message: ByteArray) = ByteArray(64)
    }

    @Test
    fun aConnectionDroppedBeforeAnAnswerIsSaidInWords() = runBlocking<Unit> {
        ServerSocket(0).use { server ->
            // Takes each request, then hangs up without a word (Java's own client asks a second time).
            thread { runCatching { while (true) server.accept().use { it.getInputStream().read(ByteArray(1024)) } } }
            val e = runCatching { NodeClient("http://127.0.0.1:${server.localPort}", signer).get("/api/team") }.exceptionOrNull() as NodeError
            assertEquals("Lost the connection to 127.0.0.1.", e.message)
            assertTrue(e.unreachable)
        }
    }

    @Test
    fun nothingListeningIsSaidInWords() = runBlocking<Unit> {
        val port = ServerSocket(0).use { it.localPort }
        val e = runCatching { NodeClient("http://127.0.0.1:$port", signer).get("/api/team") }.exceptionOrNull() as NodeError
        assertEquals("Nothing answers at 127.0.0.1. Is the node running?", e.message)
        assertTrue(e.unreachable)
    }
}
