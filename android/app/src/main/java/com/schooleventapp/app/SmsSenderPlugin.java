package com.schooleventapp.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Sends a text message straight from the phone's own SIM (its load or
 * unlimited-text promo) without opening the messaging app.
 */
@CapacitorPlugin(
    name = "SmsSender",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }) }
)
public class SmsSenderPlugin extends Plugin {

    private static final AtomicInteger REQUESTS = new AtomicInteger();
    // Android may show a "send a large number of messages?" dialog; wait for it.
    private static final long SEND_TIMEOUT_MS = 120000L;

    @PluginMethod
    public void send(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionResult");
            return;
        }
        sendNow(call);
    }

    @PermissionCallback
    private void smsPermissionResult(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            sendNow(call);
        } else {
            call.reject("SMS permission was denied.", "PERMISSION_DENIED");
        }
    }

    /** Keeps the screen on while a long batch is sending. */
    @PluginMethod
    public void keepAwake(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(
            new Runnable() {
                @Override
                public void run() {
                    Window window = activity.getWindow();
                    if (enabled) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                    call.resolve();
                }
            }
        );
    }

    private void sendNow(final PluginCall call) {
        final String to = call.getString("to");
        final String text = call.getString("text");
        if (to == null || to.trim().isEmpty() || text == null || text.isEmpty()) {
            call.reject("A phone number and a message are required.", "INVALID");
            return;
        }
        final Context context = getContext();
        try {
            SmsManager manager =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? context.getSystemService(SmsManager.class)
                    : SmsManager.getDefault();
            if (manager == null) {
                call.reject("This device cannot send text messages.", "NO_SMS");
                return;
            }
            final ArrayList<String> parts = manager.divideMessage(text);
            final int requestId = REQUESTS.incrementAndGet();
            final String action = context.getPackageName() + ".SMS_SENT_" + requestId;
            final AtomicInteger remaining = new AtomicInteger(parts.size());
            final AtomicInteger failure = new AtomicInteger(Activity.RESULT_OK);
            final AtomicBoolean finished = new AtomicBoolean(false);
            final Handler handler = new Handler(Looper.getMainLooper());

            final BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context receiverContext, Intent intent) {
                    int code = getResultCode();
                    if (code != Activity.RESULT_OK) {
                        failure.compareAndSet(Activity.RESULT_OK, code);
                    }
                    if (remaining.decrementAndGet() > 0) return;
                    if (!finished.compareAndSet(false, true)) return;
                    handler.removeCallbacksAndMessages(null);
                    try {
                        receiverContext.unregisterReceiver(this);
                    } catch (IllegalArgumentException ignored) {
                        // Already unregistered.
                    }
                    int result = failure.get();
                    if (result == Activity.RESULT_OK) {
                        JSObject response = new JSObject();
                        response.put("sent", true);
                        call.resolve(response);
                    } else {
                        call.reject(describe(result), "SEND_FAILED");
                    }
                }
            };
            ContextCompat.registerReceiver(
                context,
                receiver,
                new IntentFilter(action),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
            handler.postDelayed(
                new Runnable() {
                    @Override
                    public void run() {
                        if (!finished.compareAndSet(false, true)) return;
                        try {
                            context.unregisterReceiver(receiver);
                        } catch (IllegalArgumentException ignored) {
                            // Already unregistered.
                        }
                        call.reject("The message was not confirmed in time.", "TIMEOUT");
                    }
                },
                SEND_TIMEOUT_MS
            );

            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            for (int index = 0; index < parts.size(); index += 1) {
                Intent intent = new Intent(action).setPackage(context.getPackageName());
                sentIntents.add(
                    PendingIntent.getBroadcast(
                        context,
                        requestId * 100 + index,
                        intent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT
                    )
                );
            }
            manager.sendMultipartTextMessage(to.trim(), null, parts, sentIntents, null);
        } catch (Exception error) {
            call.reject(
                error.getMessage() == null ? "The message could not be sent." : error.getMessage(),
                "SEND_FAILED"
            );
        }
    }

    private static String describe(int resultCode) {
        switch (resultCode) {
            case 2:
                return "Airplane mode is on or the radio is off.";
            case 4:
                return "No mobile signal.";
            case 5:
                return "Android stopped the send because too many messages were sent. Allow it when asked, or try again later.";
            case 6:
                return "The number is blocked by fixed dialing.";
            default:
                return "The message could not be sent (code " + resultCode + "). Check your load or promo.";
        }
    }
}
