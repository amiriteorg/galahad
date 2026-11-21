package org.amirite.galahad.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Where a connector's key or sign-in stands, as the PWA and the Apple app say it: the parity vectors' `connectorStates`. */
class ConnectorsTest {
    private val v: Json = Json.parse(javaClass.classLoader!!.getResource("core-vectors.json")!!.readText())["connectorStates"]!!

    @Test
    fun eachStateIsSaidAsEverySurfaceSaysIt() {
        val cases = v.list
        assertTrue(cases.size >= 18)
        for (c in cases) {
            val want = c["state"].takeIf { it is Json.Obj }?.let { Connectors.State(it["label"].string!!, it["tone"].string!!) }
            assertEquals("${c["key"].string} / ${c["signIn"].string}", want, Connectors.state(c["key"].string!!, c["signIn"].string))
        }
    }

    @Test
    fun aConnectorIsReadAsTheNodeListsIt() {
        val c = Connector.of(Json.parse("""{"id":"gmail","label":"Gmail","kind":"google","installed":true,"key":"ready","needsOrigin":false,"tools":[{"name":"mail_send","description":"Send","class":"outward","asks":true}],"access":{"only":"galahad","allowed":["Gawain"]},"oauth":{"provider":"google","account":"me@example.com"},"private":true}"""))
        assertEquals("google", c.signIn)
        assertEquals("me@example.com", c.account)
        assertEquals(listOf("Gawain"), c.allowed)
        assertEquals("outward · asks you first", Connectors.classLine(c.tools.single()))
        assertEquals(Connectors.State("signed in", "ok"), Connectors.state(c.key, c.signIn))
        assertEquals("https://node.example/oauth/callback", Connectors.callback("https://node.example/"))
    }

    @Test
    fun theLibrarySaysHowManyAndWhereTheyComeFrom() {
        val page = LibraryPage.of(Json.parse("""{"entries":[{"id":"mcp-linear","label":"Linear","description":"Issues","url":"https://mcp.linear.app/mcp","site":"linear.app","category":"Work","auth":"oauth","reviewed":true,"installed":false}],"total":1540,"categories":[{"name":"Work","count":200}],"index":{"url":"https://mcp.galahad.sh","fetched":1795000000000,"count":1500,"problem":null}}"""))
        assertEquals("Signs in", libraryHow(page.entries.single().auth))
        assertEquals("1,540 servers, 30 shown. Galahad's reviewed servers, and 1,500 more the index found in the official MCP Registry, each the service's own.", libraryLine(page, 30))
        assertEquals("1 server. Galahad's reviewed servers (this node reads no index).", libraryLine(page.copy(total = 1, index = LibraryPage.Index(null, null, 0, null)), 1))
        assertEquals("1 server. The index couldn't be read (timeout): Galahad's reviewed servers are here.", libraryLine(page.copy(total = 1, index = LibraryPage.Index("https://mcp.galahad.sh", null, 0, "timeout")), 1))
        assertEquals(listOf("Work" to 200), page.shelves)
    }
}
