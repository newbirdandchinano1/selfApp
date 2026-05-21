package expo.modules.zhengbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * 自动记账等短时后台任务：前台服务保活，避免系统挂起 JS 导致 AI 请求中断。
 */
class ZhengBackgroundForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel(this)
    val notification = buildNotification(this)
    startForeground(NOTIFICATION_ID, notification)
    return START_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "zheng_background_work"
    private const val NOTIFICATION_ID = 9101
    @Volatile
    private var refCount = 0

    @Synchronized
    fun begin(context: Context) {
      refCount += 1
      if (refCount == 1) {
        val intent = Intent(context, ZhengBackgroundForegroundService::class.java)
        context.startForegroundService(intent)
      }
    }

    @Synchronized
    fun end(context: Context) {
      refCount = maxOf(0, refCount - 1)
      if (refCount == 0) {
        context.stopService(Intent(context, ZhengBackgroundForegroundService::class.java))
      }
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val mgr = context.getSystemService(NotificationManager::class.java) ?: return
      if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(
        CHANNEL_ID,
        "后台记账",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "截图自动记账识别进行中"
        setShowBadge(false)
      }
      mgr.createNotificationChannel(channel)
    }

    private fun buildNotification(context: Context): Notification {
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setContentTitle("小郑的自我修养")
        .setContentText("正在识别截图并记账…")
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
    }
  }
}
