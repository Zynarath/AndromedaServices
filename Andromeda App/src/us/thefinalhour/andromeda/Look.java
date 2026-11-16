package us.thefinalhour.andromeda;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.view.View;

import java.util.Random;

/**
 * The panel's backdrop, behind everything: black space with a faint blue and violet glow, a thin
 * blueprint grid that fades out towards the bottom, and a scattering of stars.
 */
final class Backdrop extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float[] stars = new float[0]; // x, y, radius, brightness for each

    Backdrop(Context c) {
        super(c);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        Random r = new Random(7); // the same sky every time
        int n = Math.max(40, w * h / 9000);
        stars = new float[n * 4];
        for (int i = 0; i < n; i++) {
            stars[i * 4] = r.nextFloat() * w;
            stars[i * 4 + 1] = r.nextFloat() * h;
            stars[i * 4 + 2] = Ui.dp(getContext(), 0.5f + r.nextFloat() * 0.7f) * (r.nextInt(12) == 0 ? 1.8f : 1f);
            stars[i * 4 + 3] = 0.18f + r.nextFloat() * 0.5f;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int w = getWidth(), h = getHeight();
        canvas.drawColor(Ui.BG);
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new RadialGradient(w * 0.9f, -h * 0.05f, w * 1.1f, 0x224C3CB4, 0x00000000, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);
        paint.setShader(new RadialGradient(-w * 0.1f, h * 1.05f, w, 0x181D9BF0, 0x00000000, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);
        paint.setShader(null);
        // the grid, strongest at the top
        float step = Ui.dp(getContext(), 48);
        paint.setStrokeWidth(1);
        for (float y = step; y < h * 0.7f; y += step) {
            paint.setColor(Ui.alpha(0xFFFFFF, (int) (10 * (1 - y / (h * 0.7f)))));
            canvas.drawLine(0, y, w, y, paint);
        }
        for (float x = step; x < w; x += step) {
            paint.setShader(new android.graphics.LinearGradient(0, 0, 0, h * 0.7f, 0x0AFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
            canvas.drawLine(x, 0, x, h * 0.7f, paint);
        }
        paint.setShader(null);
        for (int i = 0; i + 3 < stars.length; i += 4) {
            paint.setColor(Ui.alpha(0xFFFFFF, (int) (255 * stars[i + 3])));
            canvas.drawCircle(stars[i], stars[i + 1], stars[i + 2], paint);
        }
    }
}

/**
 * A panel as the website draws it: solid black, a hairline border with rounded corners, and the
 * small corner ticks of a technical drawing at the top left and bottom right.
 */
final class PanelDrawable extends Drawable {
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tick = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float radius, tickLength;
    private final RectF box = new RectF();

    PanelDrawable(Context c, int fillColor, int border, float radiusDp) {
        radius = Ui.dp(c, radiusDp);
        tickLength = Ui.dp(c, 10);
        fill.setColor(fillColor);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(Math.max(1, Ui.dp(c, 1)));
        line.setColor(border);
        tick.setStyle(Paint.Style.STROKE);
        tick.setStrokeWidth(Math.max(1, Ui.dp(c, 1)));
        tick.setColor(Ui.alpha(Ui.MUTED, 0xB0));
    }

    @Override
    public void draw(Canvas canvas) {
        float half = line.getStrokeWidth() / 2;
        box.set(getBounds());
        box.inset(half, half);
        canvas.drawRoundRect(box, radius, radius, fill);
        canvas.drawRoundRect(box, radius, radius, line);
        // corner ticks, just inside the rounded corners
        float l = box.left, t = box.top, r = box.right, b = box.bottom;
        canvas.drawLine(l + radius, t, l + radius + tickLength, t, tick);
        canvas.drawLine(l, t + radius, l, t + radius + tickLength, tick);
        canvas.drawLine(r - radius, b, r - radius - tickLength, b, tick);
        canvas.drawLine(r, b - radius, r, b - radius - tickLength, tick);
    }

    @Override
    public void getOutline(android.graphics.Outline outline) {
        outline.setRoundRect(getBounds(), radius);
    }

    @Override
    public void setAlpha(int alpha) {}

    @Override
    public void setColorFilter(ColorFilter filter) {}

    @Override
    public int getOpacity() {
        return PixelFormat.TRANSLUCENT;
    }
}

/** A bar chart of the last 24 hours: one bar per hour, red where something was attempted. */
final class Bars extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private double[] heights = new double[0];
    private int[] colors = new int[0];

    Bars(Context c) {
        super(c);
    }

    void set(double[] heights, int[] colors) {
        this.heights = heights;
        this.colors = colors;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int n = heights.length;
        if (n == 0) return;
        double top = 1;
        for (double v : heights) top = Math.max(top, v);
        float w = getWidth(), h = getHeight(), gap = Ui.dp(getContext(), 3), bar = (w - gap * (n - 1)) / n, r = Math.min(bar / 2, Ui.dp(getContext(), 3));
        for (int i = 0; i < n; i++) {
            float x = i * (bar + gap);
            float height = (float) Math.max(Ui.dp(getContext(), 2), heights[i] / top * h);
            paint.setColor(colors[i]);
            canvas.drawRoundRect(x, h - height, x + bar, h, r, r, paint);
        }
    }
}
