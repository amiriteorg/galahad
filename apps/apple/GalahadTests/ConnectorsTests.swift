import Foundation
import Testing
@testable import Galahad

/// Where a connector's key or sign-in stands, in the PWA's words (`lib/connector-state.ts`).
struct ConnectorsTests {
    @Test func eachConnectorsBadgeIsThePWAs() {
        for item in Vectors.shared.connectorStates {
            let state = Connectors.state(key: item.key, signsIn: item.signsIn)
            #expect(state?.label == item.state?.label && state?.tone == item.state?.tone, "\(item.key) \(item.signsIn)")
        }
    }

    @Test func googleSendsYouBackToTheAppsOwnAddressOnTheNode() {
        #expect(Connectors.callback(origin: URL(string: "https://keep.example.ts.net")!) == "https://keep.example.ts.net/oauth/callback")
        #expect(Connectors.callback(origin: URL(string: "https://keep.example.ts.net:8443/")!) == "https://keep.example.ts.net:8443/oauth/callback")
    }

    @Test func aConnectorIsReadAsTheNodeListsIt() throws {
        let json = #"{"id":"gmail","label":"Gmail","description":"Your mail.","kind":"http","url":null,"origin":"https://gmail.googleapis.com","installed":true,"key":"signed-out","secret":"gmail","keyHelp":null,"needsOrigin":false,"problem":null,"tools":[{"name":"gmail.send","description":"Send a message.","method":"POST","path":"/x","class":"outward","asks":true,"params":{}}],"access":{"only":"galahad","allowed":[]},"oauth":{"provider":"google","account":null},"private":true}"#
        let connector = try JSONDecoder().decode(ConnectorView.self, from: Data(json.utf8))
        #expect(connector.tools.first?.asks == true && connector.private && connector.oauth?.provider == "google")
        #expect(Connectors.state(key: connector.key, signsIn: true)?.label == "not signed in")
    }
}
