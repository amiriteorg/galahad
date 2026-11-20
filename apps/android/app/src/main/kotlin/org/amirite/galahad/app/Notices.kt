package org.amirite.galahad.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.amirite.galahad.MainActivity
import org.amirite.galahad.R
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.NodeClient
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.bool
import org.amirite.galahad.core.get
import org.amirite.galahad.core.list
import org.amirite.galahad.core.string

/**
 * Notifications with no push service (no Google, nobody in between): the node keeps what it would tell this phone, by
 * its own rules (the kinds you chose, quiet hours, the day's limit), and the phone collects it over its own signed
 * connection (core's `notifyCollect`): every fifteen minutes or so on Android's own schedule, which waits longer while
 * the phone sleeps, and each time the app comes to the front. Each is shown as the node told it: a title, one line,
 * where it opens. An approval told alone carries Approve and Decline (Decline alone for a delete), behind the phone's
 * own unlock, as the iPhone's does.
 */
object Notices {
    private const val JOB = 1
    /** Something waits for you: an approval, a question, a finding. It may sound. */
    private const val NEEDS = "needs-you"
    /** Work that ended, a rule of yours that told you. */
    private const val NEWS = "news"
    const val OPEN = "org.amirite.galahad.open"
    const val CONVERSATION = "org.amirite.galahad.conversation"
    private const val ACTION = "org.amirite.galahad.action"
    private const val APPROVE = "org.amirite.galahad.approve"
    private const val TAG = "org.amirite.galahad.tag"

    private fun jobs(context: Context) = context.getSystemService(JobScheduler::class.java)

    /** On here: Android asks for them on its schedule. */
    fun on(context: Context): Boolean = jobs(context).getPendingJob(JOB) != null

    /** Shown at all: Android's permission (13 and later) and the app's switch in Settings. */
    fun allowed(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    /** The node keeps them for this phone from now on, and Android asks for them. */
    suspend fun turnOn(context: Context, client: NodeClient) {
        client.post("/api/notify/collect/on", Json.obj())
        channels(context)
        val job = JobInfo.Builder(JOB, ComponentName(context, CollectJob::class.java))
            .setPeriodic(15 * 60_000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build()
        jobs(context).schedule(job)
    }

    /** Off here, and on the node: it keeps nothing more for this phone. */
    suspend fun turnOff(context: Context, client: NodeClient?) {
        stop(context)
        client?.post("/api/notify/unsubscribe", Json.obj())
    }

    /** This phone stops asking (the node already said they're off, or this phone forgot its node). */
    fun stop(context: Context) = jobs(context).cancel(JOB)

    private fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(NEEDS, "Needs you", NotificationManager.IMPORTANCE_HIGH).apply { description = "An approval, a question, something that needs you." })
        manager.createNotificationChannel(NotificationChannel(NEWS, "News", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Work that ended; a rule of yours that told you." })
    }

    /**
     * What the node kept for this phone, shown ([show] false: taken and dropped, as when the app is in front and shows
     * it all itself). False: the node says they're off for this phone (turned off somewhere else).
     */
    suspend fun collect(context: Context, client: NodeClient, show: Boolean = true): Boolean {
        val answer = client.post("/api/notify/collect", Json.obj())
        if (show && allowed(context)) for (n in answer["notifications"].list) show(context, n)
        return answer["on"].bool == true
    }

    private fun show(context: Context, n: Json) {
        val title = n["title"].string ?: return
        val body = n["body"].string ?: ""
        val tag = n["tag"].string ?: "galahad"
        val kind = n["kind"].string
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(OPEN, n["open"].string ?: "inbox")
            .apply { n["conversation"].string?.let { putExtra(CONVERSATION, it) } }
        val note = Notification.Builder(context, if (kind == "finished" || kind == "told") NEWS else NEEDS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true)
        // Answered from the notification: behind the phone's unlock, which Android 12 and later can ask for.
        val action = n["action"].string
        if (action != null && kind == "approval" && Build.VERSION.SDK_INT >= 31) {
            fun answer(approve: Boolean, label: String) = Notification.Action.Builder(
                Icon.createWithResource(context, R.drawable.ic_notify),
                label,
                PendingIntent.getBroadcast(
                    context,
                    (tag + approve).hashCode(),
                    Intent(context, NoticeAnswer::class.java).putExtra(ACTION, action).putExtra(APPROVE, approve).putExtra(TAG, tag),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            ).setAuthenticationRequired(true).build()
            // A delete is approved only where its name is typed, in the app: from here, Decline alone.
            if (n["approvable"].bool == true) note.addAction(answer(true, "Approve"))
            note.addAction(answer(false, "Decline"))
        }
        context.getSystemService(NotificationManager::class.java).notify(tag, 0, note.build())
    }

    /** After an answer from the notification: a word of how it went, in its place. */
    fun said(context: Context, tag: String, title: String, body: String, passes: Boolean) {
        val note = Notification.Builder(context, NEEDS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(PendingIntent.getActivity(context, tag.hashCode(), Intent(context, MainActivity::class.java).putExtra(OPEN, "inbox"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true)
        // An answer that went through is said and goes; one that didn't stays until you look.
        if (passes) note.setTimeoutAfter(8_000)
        context.getSystemService(NotificationManager::class.java).notify(tag, 0, note.build())
    }

    internal fun answerOf(intent: Intent): Triple<String, Boolean, String>? {
        val action = intent.getStringExtra(ACTION) ?: return null
        return Triple(action, intent.getBooleanExtra(APPROVE, false), intent.getStringExtra(TAG) ?: "galahad")
    }
}

/** Android's periodic ask: what the node kept for this phone, collected and shown. */
class CollectJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartJob(params: JobParameters): Boolean {
        val client = AppModel.of(this).client ?: run {
            Notices.stop(this)
            return false
        }
        scope.launch {
            // Turned off elsewhere (the web app, the terminal): this phone stops asking. A node out of reach is asked again next time.
            if (runCatching { Notices.collect(this@CollectJob, client) }.getOrNull() == false) Notices.stop(this@CollectJob)
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}

/** Approve or Decline, from an approval's notification: signed by this phone, as the Inbox's answer is. */
class NoticeAnswer : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val (action, approve, tag) = Notices.answerOf(intent) ?: return
        val client = AppModel.of(context).client ?: return
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                client.post("/api/actions/decide", Json.obj("id" to action, "approve" to approve))
                Notices.said(context, tag, if (approve) "Approved" else "Declined", "Galahad goes on from there.", passes = true)
            } catch (e: NodeError) {
                Notices.said(context, tag, "Still in your Inbox", e.message ?: "The answer didn't reach your node.", passes = false)
            } finally {
                done.finish()
            }
        }
    }
}
