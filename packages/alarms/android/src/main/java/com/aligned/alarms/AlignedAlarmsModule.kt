package com.aligned.alarms

import android.app.*
import android.content.*
import android.media.*
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.widget.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

private const val CHANNEL = "aligned-prominent-meetings"
private fun preferences(c: Context) = c.getSharedPreferences("aligned-alarms", Context.MODE_PRIVATE)
private fun manager(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
private fun canSchedule(c: Context) = Build.VERSION.SDK_INT < 31 || manager(c).canScheduleExactAlarms()
private fun notifications(c: Context) = (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
private fun intent(c: Context, id: String, title: String) = PendingIntent.getBroadcast(c, id.hashCode(), Intent(c, AlarmReceiver::class.java).setData(Uri.parse("aligned-alarm://" + Uri.encode(id))).putExtra("id", id).putExtra("title", title), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
private fun schedule(c: Context, id: String, title: String, at: Long): Boolean {
 if (!canSchedule(c) || !notifications(c) || at <= System.currentTimeMillis()) return false
 val pi = intent(c, id, title)
 manager(c).setAlarmClock(AlarmManager.AlarmClockInfo(at, pi), pi)
 preferences(c).edit().putString(id, JSONObject().put("title", title).put("at", at).toString()).apply()
 return true
}
class AlignedAlarmsModule: Module() {
 override fun definition() = ModuleDefinition {
  Name("AlignedAlarms")
  AsyncFunction("capability") {
   val c = appContext.reactContext ?: throw IllegalStateException("No context")
   mapOf("available" to true, "authorized" to (canSchedule(c) && notifications(c)), "reason" to "Exact alarm and notification permissions are required. Full-screen display depends on Android settings.")
  }
  AsyncFunction("requestPermission") {
   val c = appContext.reactContext ?: throw IllegalStateException("No context")
   if (!canSchedule(c) && Build.VERSION.SDK_INT >= 31) c.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + c.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
   canSchedule(c) && notifications(c)
  }
  AsyncFunction("schedule") { id: String, title: String, seconds: Double ->
   schedule(appContext.reactContext ?: throw IllegalStateException("No context"), id, title, (seconds * 1000).toLong())
  }
  AsyncFunction("cancel") { id: String ->
   val c = appContext.reactContext ?: throw IllegalStateException("No context")
   manager(c).cancel(intent(c, id, "")); c.stopService(Intent(c, AlarmSoundService::class.java)); preferences(c).edit().remove(id).apply()
   (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id.hashCode())
  }
 }
}
class BootReceiver: BroadcastReceiver() {
 override fun onReceive(c: Context, i: Intent) { for ((id, raw) in preferences(c).all) try { val o = JSONObject(raw as String); if (!schedule(c, id, o.getString("title"), o.getLong("at"))) preferences(c).edit().remove(id).apply() } catch (_: Exception) {} }
}
class AlarmReceiver: BroadcastReceiver() {
 override fun onReceive(c: Context, i: Intent) {
  val id = i.getStringExtra("id") ?: return
  if (!preferences(c).contains(id)) return
  val service = Intent(c, AlarmSoundService::class.java).putExtra("id", id).putExtra("title", i.getStringExtra("title") ?: "Upcoming meeting")
  if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(service) else c.startService(service)
  preferences(c).edit().remove(id).apply()
 }
}
class AlarmSoundService: Service() {
 private var player: MediaPlayer? = null
 override fun onBind(i: Intent?) = null
 override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
  if (i?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
  val id = i?.getStringExtra("id") ?: "meeting"
  val title = i?.getStringExtra("title") ?: "Upcoming meeting"
  val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Prominent meeting alarms", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) })
  val screen = PendingIntent.getActivity(this, id.hashCode(), Intent(this, AlarmActivity::class.java).putExtra("title", title), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val stop = PendingIntent.getService(this, 0, Intent(this, AlarmSoundService::class.java).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
  val notification = builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(title).setContentText("Your meeting starts in 15 minutes").setCategory(Notification.CATEGORY_ALARM).setOngoing(true).setContentIntent(screen).setFullScreenIntent(screen, true).addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
  startForeground(id.hashCode(), notification)
  try { player = MediaPlayer().apply { setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()); setDataSource(this@AlarmSoundService, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)); isLooping = true; prepare(); start() } } catch (_: Exception) {}
  Handler(Looper.getMainLooper()).postDelayed({ stopSelf() }, 120000)
  return START_NOT_STICKY
 }
 override fun onDestroy() { player?.release(); player = null; super.onDestroy() }
}
class AlarmActivity: Activity() {
 override fun onCreate(state: Bundle?) {
  super.onCreate(state)
  if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
  val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER; setPadding(48, 48, 48, 48) }
  layout.addView(TextView(this).apply { text = intent.getStringExtra("title") ?: "Upcoming meeting"; textSize = 30f })
  layout.addView(TextView(this).apply { text = "Starts in 15 minutes"; textSize = 18f })
  layout.addView(Button(this).apply { text = "Stop alarm"; setOnClickListener { stopService(Intent(this@AlarmActivity, AlarmSoundService::class.java)); finish() } })
  setContentView(layout)
 }
}
