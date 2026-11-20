package org.amirite.galahad

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Notices
import org.amirite.galahad.core.Joining
import org.amirite.galahad.ui.GalahadTheme
import org.amirite.galahad.ui.JoinScreen
import org.amirite.galahad.ui.Root

class MainActivity : ComponentActivity() {
    private val app by lazy { AppModel.of(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        take(intent)
        // The node is asked only while the app is on screen.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                app.inFront()
                app.poll()
            }
        }
        setContent {
            GalahadTheme {
                Surface(Modifier.fillMaxSize()) {
                    val paired by app.paired.collectAsState()
                    if (paired == null) JoinScreen(app) else Root(app)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        take(intent)
    }

    /** A tapped notification opens where it says; a `galahad:` link carrying an invite, opened on this phone, fills in the join. */
    private fun take(intent: Intent?) {
        intent?.getStringExtra(Notices.OPEN)?.let { open ->
            app.opening.value = open to intent.getStringExtra(Notices.CONVERSATION)
            return
        }
        val link = intent?.dataString ?: intent?.getStringExtra(Intent.EXTRA_TEXT) ?: return
        Joining.handed(link)?.let { app.handed.value = it }
    }
}
