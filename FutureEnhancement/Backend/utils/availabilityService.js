'use strict';

const EquipmentRental = require('../models/EquipmentRental');
const Equipment = require('../models/Equipment');
const { createError } = require('./helpers');

/**
 * Equipment Availability & Conflict Detection Service
 */
class AvailabilityService {
    /**
     * Check if an equipment is available for the requested slot
     */
    static async checkAvailability(equipmentId, startDate, endDate, startTime, endTime, excludeRentalId = null) {
        const equipment = await Equipment.findById(equipmentId);
        if (!equipment) throw createError('Equipment not found', 404);

        if (!equipment.isActive || !equipment.isVerified) {
            throw createError('Equipment is not available for rental', 400);
        }
        if (equipment.status === 'maintenance' || equipment.status === 'inactive') {
            throw createError(`Equipment is currently in ${equipment.status} status`, 400);
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
        const hasBlackout = equipment.availability.blackoutDates.some((bd) => {
            const blackout = new Date(bd);
            return blackout >= start && blackout <= end;
        });
        if (hasBlackout) {
            throw createError('Equipment has maintenance/blocked dates in the requested period', 409);
        }

        // Check working days
        const requestedDays = this._getDatesInRange(start, end);
        const offDays = requestedDays.filter((date) => {
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
            return !equipment.availability.workingDays.includes(dayName);
        });
        if (offDays.length > 0) {
            throw createError(
                `Equipment is not available on: ${offDays.map((d) => d.toDateString()).join(', ')}`, 400
            );
        }

        // Check time conflicts
        const conflictQuery = {
            equipment: equipmentId,
            status: { $in: ['requested', 'approved', 'active'] },
            $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
        };
        if (excludeRentalId) conflictQuery._id = { $ne: excludeRentalId };

        const conflictingRentals = await EquipmentRental.find(conflictQuery)
            .select('bookingId startDate endDate startTime endTime status');

        const timeConflicts = conflictingRentals.filter((rental) =>
            this._hasTimeOverlap(startTime, endTime, rental.startTime, rental.endTime,
                start, end, rental.startDate, rental.endDate)
        );

        if (timeConflicts.length > 0) {
            throw createError('Time slot conflict detected. Equipment is already booked during this period.', 409, {
                conflicts: timeConflicts.map((r) => ({
                    bookingId: r.bookingId,
                    from: `${r.startDate.toDateString()} ${r.startTime}`,
                    to: `${r.endDate.toDateString()} ${r.endTime}`,
                    status: r.status,
                })),
            });
        }

        return { available: true, equipment: { id: equipment._id, name: equipment.name, category: equipment.category, status: equipment.status } };
    }

    static async getAvailableSlots(equipmentId, fromDate, toDate) {
        const equipment = await Equipment.findById(equipmentId);
        if (!equipment) throw createError('Equipment not found', 404);

        const existingRentals = await EquipmentRental.find({
            equipment: equipmentId,
            status: { $in: ['requested', 'approved', 'active'] },
            startDate: { $lte: new Date(toDate) },
            endDate: { $gte: new Date(fromDate) },
        }).select('startDate endDate startTime endTime status');

        const dates = this._getDatesInRange(new Date(fromDate), new Date(toDate));
        return dates.map((date) => {
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
            const isWorkingDay = equipment.availability.workingDays.includes(dayName);
            const isBlackedOut = equipment.availability.blackoutDates.some(
                (bd) => new Date(bd).toDateString() === date.toDateString()
            );
            const dayBookings = existingRentals
                .filter((r) => date >= new Date(r.startDate) && date <= new Date(r.endDate))
                .map((r) => ({ time: `${r.startTime}-${r.endTime}`, status: r.status }));

            return {
                date: date.toISOString().split('T')[0],
                dayName,
                isWorkingDay,
                isBlackedOut,
                isAvailable: isWorkingDay && !isBlackedOut && dayBookings.length === 0,
                bookedSlots: dayBookings,
                availableFrom: equipment.availability.defaultStartTime,
                availableTo: equipment.availability.defaultEndTime,
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
