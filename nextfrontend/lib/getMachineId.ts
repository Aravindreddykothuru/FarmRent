export type Machine = {
    id?: string;
    _id?: string;
    name: string;
    price?: number;
    location?: {
        full?: string;
        village?: string;
        town?: string;
        district?: string;
        state?: string;
        pincode?: string;
        coordinates?: { coordinates?: [number, number] };
    };
    images?: string[];
    type?: string;
    pricing?: { baseRatePerDay?: number };
    ratings?: { average?: number };
    avg_rating?: number;
    status?: string;
};

export function getMachineId(machine: any): string | null {
    return machine?.id || machine?._id || null;
}

