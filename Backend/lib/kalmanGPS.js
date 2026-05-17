/**
 * kalmanGPS.js — 1D Kalman Filter for GPS coordinate smoothing
 *
 * Reduces noise from GPS jitter by maintaining a probabilistic state estimate.
 * Applied per-axis (lat/lng) independently.
 *
 * Based on: standard discrete Kalman filter
 *   Predict: P = P + Q
 *   Update:  K = P / (P + R); x = x + K*(z - x); P = (1-K)*P
 *
 * Q = process noise (how much real movement uncertainty exists per step)
 * R = measurement noise (GPS hardware accuracy, larger = noisier sensor)
 */
class KalmanFilter1D {
    constructor({ Q = 1e-6, R = 0.0001 } = {}) {
        this.Q = Q;
        this.R = R;
        this.P = 1;   // initial estimate error covariance
        this.K = 0;   // Kalman gain
        this.x = null; // state estimate
    }

    filter(measurement) {
        if (this.x === null) {
            this.x = measurement;
            return measurement;
        }
        // Predict step
        this.P = this.P + this.Q;
        // Update step
        this.K = this.P / (this.P + this.R);
        this.x = this.x + this.K * (measurement - this.x);
        this.P = (1 - this.K) * this.P;
        return this.x;
    }

    reset() { this.x = null; this.P = 1; }
}

/**
 * GPSKalmanFilter — smooths lat/lng with accuracy-adaptive noise.
 * Pass accuracy (meters) per point so measurement noise adapts dynamically.
 */
class GPSKalmanFilter {
    constructor() {
        this.latFilter = new KalmanFilter1D();
        this.lngFilter = new KalmanFilter1D();
    }

    /**
     * @param {number} lat
     * @param {number} lng
     * @param {number} accuracy - GPS accuracy in meters (default 10m)
     * @returns {{ lat: number, lng: number }}
     */
    filter(lat, lng, accuracy = 10) {
        // 1 meter ≈ 0.000009°. Variance = (accuracy_in_deg)²
        const R = Math.max(1e-10, (Math.max(accuracy, 0.5) * 9e-6) ** 2);
        this.latFilter.R = R;
        this.lngFilter.R = R;
        return {
            lat: this.latFilter.filter(lat),
            lng: this.lngFilter.filter(lng),
        };
    }

    reset() { this.latFilter.reset(); this.lngFilter.reset(); }
}

module.exports = { GPSKalmanFilter, KalmanFilter1D };
