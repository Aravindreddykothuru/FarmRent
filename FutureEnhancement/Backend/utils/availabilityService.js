'use strict';

const Booking = require('../models/Booking');
const Machine = require('../models/Machine');
const { createError } = require('./helpers');

/**
 * Machine Availability & Conflict Detection Service
 */
class AvailabilityService {
    /**
     * Check if a machine is available for the requested slot
     */
    static async checkAvailability(machineId, startDate, endDate, startTime, endTime, excludeBookingId = null) {
        const machine = await Machine.findById(machineId);
        if (!machine) throw createError('Machine not found', 404);

        if (!machine.isActive || !machine.isApproved) {
            throw createError('Machine is not available for booking', 400);
        }
        if (machine.status === 'maintenance' || machine.status === 'inactive') {
            throw createError(`Machine is currently in ${machine.status} status`, 400);
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start < new Date().setHours(0, 0, 0, 0)) {
            throw createError('Start date cannot be in the past', 400);
        }
        if (end < start) {
            throw createError('End date must be after or equal to start date', 400);
        }

        // Check blackout dates
        const hasBlackout = machine.availability.blackoutDates.some((bd) => {
            const blackout = new Date(bd);
            return blackout >= start && blackout <= end;
        });
        if (hasBlackout) {
            throw createError('Machine has maintenance/blocked dates in the requested period', 409);
        }

        // Check working days
        const requestedDays = this._getDatesInRange(start, end);
        const offDays = requestedDays.filter((date) => {
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
            return !machine.availability.workingDays.includes(dayName);
        });
        if (offDays.length > 0) {
            throw createError(
                `Machine is not available on: ${offDays.map((d) => d.toDateString()).join(', ')}`, 400
            );
        }

        // Check time conflicts
        const conflictQuery = {
            machine: machineId,
            status: { $in: ['pending', 'confirmed', 'active'] },
            $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
        };
        if (excludeBookingId) conflictQuery._id = { $ne: excludeBookingId };

        const conflictingBookings = await Booking.find(conflictQuery)
            .select('bookingId startDate endDate startTime endTime status');

        const timeConflicts = conflictingBookings.filter((booking) =>
            this._hasTimeOverlap(startTime, endTime, booking.startTime, booking.endTime,
                start, end, booking.startDate, booking.endDate)
        );

        if (timeConflicts.length > 0) {
            throw createError('Time slot conflict detected. Machine is already booked during this period.', 409, {
                conflicts: timeConflicts.map((b) => ({
                    bookingId: b.bookingId,
                    from: `${b.startDate.toDateString()} ${b.startTime}`,
                    to: `${b.endDate.toDateString()} ${b.endTime}`,
                    status: b.status,
                })),
            });
        }

        return { available: true, machine: { id: machine._id, name: machine.name, type: machine.type, status: machine.status } };
    }

    static async getAvailableSlots(machineId, fromDate, toDate) {
        const machine = await Machine.findById(machineId);
        if (!machine) throw createError('Machine not found', 404);

        const existingBookings = await Booking.find({
            machine: machineId,
            status: { $in: ['confirmed', 'active', 'pending'] },
            startDate: { $lte: new Date(toDate) },
            endDate: { $gte: new Date(fromDate) },
        }).select('startDate endDate startTime endTime status');

        const dates = this._getDatesInRange(new Date(fromDate), new Date(toDate));
        return dates.map((date) => {
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
            const isWorkingDay = machine.availability.workingDays.includes(dayName);
            const isBlackedOut = machine.availability.blackoutDates.some(
                (bd) => new Date(bd).toDateString() === date.toDateString()
            );
            const dayBookings = existingBookings
                .filter((b) => date >= new Date(b.startDate) && date <= new Date(b.endDate))
                .map((b) => ({ time: `${b.startTime}-${b.endTime}`, status: b.status }));

            return {
                date: date.toISOString().split('T')[0],
                dayName,
                isWorkingDay,
                isBlackedOut,
                isAvailable: isWorkingDay && !isBlackedOut && dayBookings.length === 0,
                bookedSlots: dayBookings,
                availableFrom: machine.availability.defaultStartTime,
                availableTo: machine.availability.defaultEndTime,
            };
        });
    }

    static _hasTimeOverlap(startTime1, endTime1, startTime2, endTime2, date1Start, date1End, date2Start, date2End) {
        if (date1Start <= date2End && date1End >= date2Start) {
            const t1s = this._timeToMinutes(startTime1);
            const t1e = this._timeToMinutes(endTime1);
            const t2s = this._timeToMinutes(startTime2);
            const t2e = this._timeToMinutes(endTime2);
            return t1s < t2e && t1e > t2s;
        }
        return false;
    }

    static _timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    static _getDatesInRange(start, end) {
        const dates = [];
        const current = new Date(start);
        while (current <= end) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }
}

module.exports = AvailabilityService;
