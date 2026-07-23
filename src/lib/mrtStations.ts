// Heavy-rail MRT stations vendored from NexDoor-Calculator (src/App.jsx
// MRT_STATIONS) — the same set powering the Wealth Planner / Calculator map:
// 171 stations, 145 currently open. Plus 38 LRT stops (Bukit Panjang, Sengkang
// east/west, Punggol east/west loops), all open, sourced from OpenStreetMap
// (railway station/stop nodes, refs BP*/SW*/SE*/PW*/PE*; interchanges CCK, Bukit
// Panjang, Sengkang, Punggol already appear in the MRT set and are excluded).
// Total: 209 stations, 183 open. Used by the condo/EC cross-project fallback to
// weight comparables by walking-distance-to-nearest-open-station similarity
// (Stage 4). LRT stops carry `line: 'lrt'` so they stay distinguishable, but the
// nearest-station distance term counts them the same as MRT — an LRT-served
// project's real transit access is the LRT stop, not the MRT 1–2 km away.
//
// Refresh when new MRT lines open (currently CRL/JRL are 'future').
export type MrtStation = { lat: number; lon: number; status: 'open' | 'future'; line?: 'lrt' }

export const MRT_STATIONS: MrtStation[] = [
  { lat: 1.3329, lon: 103.7424, status: 'open' }, // Jurong East
  { lat: 1.349, lon: 103.7496, status: 'open' }, // Bukit Batok
  { lat: 1.3586, lon: 103.7519, status: 'open' }, // Bukit Gombak
  { lat: 1.3853, lon: 103.7441, status: 'open' }, // Choa Chu Kang
  { lat: 1.3973, lon: 103.7474, status: 'open' }, // Yew Tee
  { lat: 1.4252, lon: 103.7619, status: 'open' }, // Kranji
  { lat: 1.4326, lon: 103.7742, status: 'open' }, // Marsiling
  { lat: 1.437, lon: 103.7864, status: 'open' }, // Woodlands
  { lat: 1.4406, lon: 103.8006, status: 'open' }, // Admiralty
  { lat: 1.4491, lon: 103.8199, status: 'open' }, // Sembawang
  { lat: 1.4432, lon: 103.8299, status: 'open' }, // Canberra
  { lat: 1.4294, lon: 103.8354, status: 'open' }, // Yishun
  { lat: 1.4175, lon: 103.833, status: 'open' }, // Khatib
  { lat: 1.3817, lon: 103.8448, status: 'open' }, // Yio Chu Kang
  { lat: 1.37, lon: 103.8497, status: 'open' }, // Ang Mo Kio
  { lat: 1.351, lon: 103.8486, status: 'open' }, // Bishan
  { lat: 1.3403, lon: 103.8469, status: 'open' }, // Braddell
  { lat: 1.3325, lon: 103.8474, status: 'open' }, // Toa Payoh
  { lat: 1.3202, lon: 103.8437, status: 'open' }, // Novena
  { lat: 1.3131, lon: 103.8384, status: 'open' }, // Newton
  { lat: 1.3043, lon: 103.8319, status: 'open' }, // Orchard
  { lat: 1.3004, lon: 103.8389, status: 'open' }, // Somerset
  { lat: 1.299, lon: 103.8459, status: 'open' }, // Dhoby Ghaut
  { lat: 1.2931, lon: 103.852, status: 'open' }, // City Hall
  { lat: 1.284, lon: 103.8513, status: 'open' }, // Raffles Place
  { lat: 1.2764, lon: 103.8548, status: 'open' }, // Marina Bay
  { lat: 1.271, lon: 103.8634, status: 'open' }, // Marina South Pier
  { lat: 1.3731, lon: 103.9494, status: 'open' }, // Pasir Ris
  { lat: 1.3528, lon: 103.9453, status: 'open' }, // Tampines
  { lat: 1.3432, lon: 103.9532, status: 'open' }, // Simei
  { lat: 1.3273, lon: 103.9462, status: 'open' }, // Tanah Merah
  { lat: 1.324, lon: 103.93, status: 'open' }, // Bedok
  { lat: 1.3211, lon: 103.9129, status: 'open' }, // Kembangan
  { lat: 1.3196, lon: 103.9031, status: 'open' }, // Eunos
  { lat: 1.318, lon: 103.893, status: 'open' }, // Paya Lebar
  { lat: 1.3162, lon: 103.8831, status: 'open' }, // Aljunied
  { lat: 1.3113, lon: 103.8714, status: 'open' }, // Kallang
  { lat: 1.3074, lon: 103.8635, status: 'open' }, // Lavender
  { lat: 1.3006, lon: 103.856, status: 'open' }, // Bugis
  { lat: 1.2765, lon: 103.8454, status: 'open' }, // Tanjong Pagar
  { lat: 1.2802, lon: 103.8393, status: 'open' }, // Outram Park
  { lat: 1.286, lon: 103.827, status: 'open' }, // Tiong Bahru
  { lat: 1.2893, lon: 103.8167, status: 'open' }, // Redhill
  { lat: 1.2947, lon: 103.8063, status: 'open' }, // Queenstown
  { lat: 1.3021, lon: 103.7981, status: 'open' }, // Commonwealth
  { lat: 1.307, lon: 103.79, status: 'open' }, // Buona Vista
  { lat: 1.3113, lon: 103.7788, status: 'open' }, // Dover
  { lat: 1.3153, lon: 103.7649, status: 'open' }, // Clementi
  { lat: 1.3425, lon: 103.7322, status: 'open' }, // Chinese Garden
  { lat: 1.3442, lon: 103.7203, status: 'open' }, // Lakeside
  { lat: 1.3387, lon: 103.706, status: 'open' }, // Boon Lay
  { lat: 1.3368, lon: 103.697, status: 'open' }, // Pioneer
  { lat: 1.3278, lon: 103.6786, status: 'open' }, // Joo Koon
  { lat: 1.3194, lon: 103.6615, status: 'open' }, // Gul Circle
  { lat: 1.3207, lon: 103.6406, status: 'open' }, // Tuas Crescent
  { lat: 1.3273, lon: 103.6273, status: 'open' }, // Tuas West Road
  { lat: 1.3407, lon: 103.6378, status: 'open' }, // Tuas Link
  { lat: 1.3354, lon: 103.9615, status: 'open' }, // Expo
  { lat: 1.3574, lon: 103.9883, status: 'open' }, // Changi Airport
  { lat: 1.2966, lon: 103.8502, status: 'open' }, // Bras Basah
  { lat: 1.2937, lon: 103.8554, status: 'open' }, // Esplanade
  { lat: 1.2938, lon: 103.8613, status: 'open' }, // Promenade
  { lat: 1.2998, lon: 103.8631, status: 'open' }, // Nicoll Highway
  { lat: 1.3028, lon: 103.8748, status: 'open' }, // Stadium
  { lat: 1.3064, lon: 103.882, status: 'open' }, // Mountbatten
  { lat: 1.3083, lon: 103.8883, status: 'open' }, // Dakota
  { lat: 1.3267, lon: 103.8888, status: 'open' }, // MacPherson
  { lat: 1.3358, lon: 103.8882, status: 'open' }, // Tai Seng
  { lat: 1.3427, lon: 103.8809, status: 'open' }, // Bartley
  { lat: 1.3499, lon: 103.8731, status: 'open' }, // Serangoon
  { lat: 1.3518, lon: 103.8649, status: 'open' }, // Lorong Chuan
  { lat: 1.3491, lon: 103.8393, status: 'open' }, // Marymount
  { lat: 1.3376, lon: 103.8393, status: 'open' }, // Caldecott
  { lat: 1.3224, lon: 103.8154, status: 'open' }, // Botanic Gardens
  { lat: 1.3173, lon: 103.8079, status: 'open' }, // Farrer Road
  { lat: 1.3113, lon: 103.7961, status: 'open' }, // Holland Village
  { lat: 1.2993, lon: 103.7873, status: 'open' }, // one-north
  { lat: 1.2934, lon: 103.7846, status: 'open' }, // Kent Ridge
  { lat: 1.2831, lon: 103.7821, status: 'open' }, // Haw Par Villa
  { lat: 1.2762, lon: 103.792, status: 'open' }, // Pasir Panjang
  { lat: 1.2726, lon: 103.8025, status: 'open' }, // Labrador Park
  { lat: 1.2705, lon: 103.8097, status: 'open' }, // Telok Blangah
  { lat: 1.2652, lon: 103.8203, status: 'open' }, // Harbourfront
  { lat: 1.2822, lon: 103.8597, status: 'open' }, // Bayfront
  { lat: 1.3787, lon: 103.7619, status: 'open' }, // Bukit Panjang (DTL/BPLRT interchange; was 103.7762, ~1.6km too far east)
  { lat: 1.3694, lon: 103.7764, status: 'open' }, // Cashew
  { lat: 1.3623, lon: 103.7672, status: 'open' }, // Hillview
  { lat: 1.3412, lon: 103.7759, status: 'open' }, // Beauty World
  { lat: 1.3355, lon: 103.7784, status: 'open' }, // King Albert Park
  { lat: 1.3319, lon: 103.795, status: 'open' }, // Sixth Avenue
  { lat: 1.3256, lon: 103.8075, status: 'open' }, // Tan Kah Kee
  { lat: 1.3197, lon: 103.8264, status: 'open' }, // Stevens
  { lat: 1.3066, lon: 103.8494, status: 'open' }, // Little India
  { lat: 1.3031, lon: 103.8527, status: 'open' }, // Rochor
  { lat: 1.2793, lon: 103.8527, status: 'open' }, // Downtown
  { lat: 1.2818, lon: 103.8478, status: 'open' }, // Telok Ayer
  { lat: 1.2916, lon: 103.8444, status: 'open' }, // Fort Canning
  { lat: 1.2981, lon: 103.8499, status: 'open' }, // Bencoolen
  { lat: 1.3047, lon: 103.8556, status: 'open' }, // Jalan Besar
  { lat: 1.3148, lon: 103.8638, status: 'open' }, // Bendemeer
  { lat: 1.3213, lon: 103.8713, status: 'open' }, // Geylang Bahru
  { lat: 1.3244, lon: 103.8826, status: 'open' }, // Mattar
  { lat: 1.3257, lon: 103.8982, status: 'open' }, // Ubi
  { lat: 1.335, lon: 103.9067, status: 'open' }, // Kaki Bukit
  { lat: 1.3328, lon: 103.9163, status: 'open' }, // Bedok North
  { lat: 1.3355, lon: 103.9322, status: 'open' }, // Bedok Reservoir
  { lat: 1.3463, lon: 103.9379, status: 'open' }, // Tampines West
  { lat: 1.3575, lon: 103.9553, status: 'open' }, // Tampines East
  { lat: 1.3413, lon: 103.9614, status: 'open' }, // Upper Changi
  { lat: 1.448, lon: 103.82, status: 'open' }, // Woodlands North
  { lat: 1.4243, lon: 103.796, status: 'open' }, // Woodlands South
  { lat: 1.399, lon: 103.8189, status: 'open' }, // Springleaf
  { lat: 1.384, lon: 103.8356, status: 'open' }, // Lentor
  { lat: 1.3712, lon: 103.8386, status: 'open' }, // Mayflower
  { lat: 1.3612, lon: 103.833, status: 'open' }, // Bright Hill
  { lat: 1.354, lon: 103.8318, status: 'open' }, // Upper Thomson
  { lat: 1.3226, lon: 103.8313, status: 'open' }, // Mount Pleasant
  { lat: 1.3066, lon: 103.8198, status: 'open' }, // Napier
  { lat: 1.2989, lon: 103.8231, status: 'open' }, // Orchard Boulevard
  { lat: 1.294, lon: 103.836, status: 'open' }, // Great World
  { lat: 1.2887, lon: 103.8394, status: 'open' }, // Havelock
  { lat: 1.2797, lon: 103.8449, status: 'open' }, // Maxwell
  { lat: 1.277, lon: 103.848, status: 'open' }, // Shenton Way
  { lat: 1.2816, lon: 103.8654, status: 'open' }, // Gardens by the Bay
  { lat: 1.2996, lon: 103.877, status: 'open' }, // Tanjong Rhu
  { lat: 1.3025, lon: 103.8916, status: 'open' }, // Katong Park
  { lat: 1.306, lon: 103.9009, status: 'open' }, // Tanjong Katong
  { lat: 1.3025, lon: 103.9063, status: 'open' }, // Marine Parade
  { lat: 1.3063, lon: 103.9159, status: 'open' }, // Marine Terrace
  { lat: 1.3107, lon: 103.9264, status: 'open' }, // Siglap
  { lat: 1.3145, lon: 103.9371, status: 'open' }, // Bayshore
  { lat: 1.3213, lon: 103.9466, status: 'open' }, // Bedok South
  { lat: 1.3278, lon: 103.9556, status: 'open' }, // Sungei Bedok
  { lat: 1.2652, lon: 103.8203, status: 'open' }, // HarbourFront
  { lat: 1.2836, lon: 103.8443, status: 'open' }, // Chinatown
  { lat: 1.2884, lon: 103.8464, status: 'open' }, // Clarke Quay
  { lat: 1.3121, lon: 103.8558, status: 'open' }, // Farrer Park
  { lat: 1.3193, lon: 103.8617, status: 'open' }, // Boon Keng
  { lat: 1.3317, lon: 103.8687, status: 'open' }, // Potong Pasir
  { lat: 1.3389, lon: 103.8706, status: 'open' }, // Woodleigh
  { lat: 1.3598, lon: 103.8856, status: 'open' }, // Kovan
  { lat: 1.3714, lon: 103.8921, status: 'open' }, // Hougang
  { lat: 1.3832, lon: 103.893, status: 'open' }, // Buangkok
  { lat: 1.3916, lon: 103.8954, status: 'open' }, // Sengkang
  { lat: 1.4053, lon: 103.9022, status: 'open' }, // Punggol
  // ─── LRT stops (OpenStreetMap, all open) — Bukit Panjang / Sengkang / Punggol ───
  { lat: 1.38027, lon: 103.74528, status: 'open', line: 'lrt' }, // South View (BPLRT BP2)
  { lat: 1.3786, lon: 103.74902, status: 'open', line: 'lrt' }, // Keat Hong (BPLRT BP3)
  { lat: 1.37667, lon: 103.75365, status: 'open', line: 'lrt' }, // Teck Whye (BPLRT BP4)
  { lat: 1.37862, lon: 103.75801, status: 'open', line: 'lrt' }, // Phoenix (BPLRT BP5)
  { lat: 1.37777, lon: 103.76663, status: 'open', line: 'lrt' }, // Petir (BPLRT BP7)
  { lat: 1.37618, lon: 103.77126, status: 'open', line: 'lrt' }, // Pending (BPLRT BP8)
  { lat: 1.38004, lon: 103.77265, status: 'open', line: 'lrt' }, // Bangkit (BPLRT BP9)
  { lat: 1.38459, lon: 103.77088, status: 'open', line: 'lrt' }, // Fajar (BPLRT BP10)
  { lat: 1.38779, lon: 103.76958, status: 'open', line: 'lrt' }, // Segar (BPLRT BP11)
  { lat: 1.38669, lon: 103.76451, status: 'open', line: 'lrt' }, // Jelapang (BPLRT BP12)
  { lat: 1.38268, lon: 103.76238, status: 'open', line: 'lrt' }, // Senja (BPLRT BP13)
  { lat: 1.39629, lon: 103.89379, status: 'open', line: 'lrt' }, // Cheng Lim (SKLRT SW1)
  { lat: 1.39719, lon: 103.88922, status: 'open', line: 'lrt' }, // Farmway (SKLRT SW2)
  { lat: 1.3982, lon: 103.88125, status: 'open', line: 'lrt' }, // Kupang (SKLRT SW3)
  { lat: 1.39733, lon: 103.87563, status: 'open', line: 'lrt' }, // Thanggam (SKLRT SW4)
  { lat: 1.3919, lon: 103.87628, status: 'open', line: 'lrt' }, // Fernvale (SKLRT SW5)
  { lat: 1.39208, lon: 103.88003, status: 'open', line: 'lrt' }, // Layar (SKLRT SW6)
  { lat: 1.38941, lon: 103.88583, status: 'open', line: 'lrt' }, // Tongkang (SKLRT SW7)
  { lat: 1.38673, lon: 103.89053, status: 'open', line: 'lrt' }, // Renjong (SKLRT SW8)
  { lat: 1.39452, lon: 103.90043, status: 'open', line: 'lrt' }, // Compassvale (SKLRT SE1)
  { lat: 1.39147, lon: 103.90597, status: 'open', line: 'lrt' }, // Rumbia (SKLRT SE2)
  { lat: 1.38801, lon: 103.90542, status: 'open', line: 'lrt' }, // Bakau (SKLRT SE3)
  { lat: 1.38393, lon: 103.90221, status: 'open', line: 'lrt' }, // Kangkar (SKLRT SE4)
  { lat: 1.38405, lon: 103.89736, status: 'open', line: 'lrt' }, // Ranggung (SKLRT SE5)
  { lat: 1.40972, lon: 103.90489, status: 'open', line: 'lrt' }, // Sam Kee (PGLRT PW1)
  { lat: 1.41276, lon: 103.90657, status: 'open', line: 'lrt' }, // Teck Lee (PGLRT PW2)
  { lat: 1.41685, lon: 103.90666, status: 'open', line: 'lrt' }, // Punggol Point (PGLRT PW3)
  { lat: 1.41592, lon: 103.90218, status: 'open', line: 'lrt' }, // Samudera (PGLRT PW4)
  { lat: 1.41189, lon: 103.90037, status: 'open', line: 'lrt' }, // Nibong (PGLRT PW5)
  { lat: 1.40848, lon: 103.89858, status: 'open', line: 'lrt' }, // Sumang (PGLRT PW6)
  { lat: 1.40532, lon: 103.89726, status: 'open', line: 'lrt' }, // Soo Teck (PGLRT PW7)
  { lat: 1.39946, lon: 103.90577, status: 'open', line: 'lrt' }, // Cove (PGLRT PE1)
  { lat: 1.39694, lon: 103.90888, status: 'open', line: 'lrt' }, // Meridian (PGLRT PE2)
  { lat: 1.39386, lon: 103.91266, status: 'open', line: 'lrt' }, // Coral Edge (PGLRT PE3)
  { lat: 1.39453, lon: 103.91615, status: 'open', line: 'lrt' }, // Riviera (PGLRT PE4)
  { lat: 1.39955, lon: 103.91651, status: 'open', line: 'lrt' }, // Kadaloor (PGLRT PE5)
  { lat: 1.40227, lon: 103.91274, status: 'open', line: 'lrt' }, // Oasis (PGLRT PE6)
  { lat: 1.40524, lon: 103.90862, status: 'open', line: 'lrt' }, // Damai (PGLRT PE7)
  { lat: 1.36, lon: 103.985, status: 'future' }, // Aviation Park
  { lat: 1.37, lon: 103.97, status: 'future' }, // Loyang
  { lat: 1.375, lon: 103.96, status: 'future' }, // Pasir Ris East
  { lat: 1.39, lon: 103.938, status: 'future' }, // Tampines North
  { lat: 1.38, lon: 103.905, status: 'future' }, // Defu
  { lat: 1.38, lon: 103.875, status: 'future' }, // Serangoon North
  { lat: 1.365, lon: 103.845, status: 'future' }, // Teck Ghee
  { lat: 1.33, lon: 103.805, status: 'future' }, // Turf City
  { lat: 1.33, lon: 103.765, status: 'future' }, // Maju
  { lat: 1.31, lon: 103.76, status: 'future' }, // West Coast
  { lat: 1.335, lon: 103.74, status: 'future' }, // Jurong Lake District
  { lat: 1.39, lon: 103.735, status: 'future' }, // Choa Chu Kang West
  { lat: 1.38, lon: 103.725, status: 'future' }, // Tengah
  { lat: 1.37, lon: 103.72, status: 'future' }, // Hong Kah
  { lat: 1.36, lon: 103.715, status: 'future' }, // Corporation
  { lat: 1.35, lon: 103.705, status: 'future' }, // Jurong West
  { lat: 1.345, lon: 103.715, status: 'future' }, // Bahar Junction
  { lat: 1.375, lon: 103.73, status: 'future' }, // Peng Kang Hill
  { lat: 1.382, lon: 103.718, status: 'future' }, // Tengah Park
  { lat: 1.358, lon: 103.743, status: 'future' }, // Bukit Batok West
  { lat: 1.348, lon: 103.72, status: 'future' }, // Tawas
  { lat: 1.34, lon: 103.69, status: 'future' }, // Nanyang Gateway
  { lat: 1.335, lon: 103.68, status: 'future' }, // Nanyang Crescent
  { lat: 1.325, lon: 103.705, status: 'future' }, // Pandan Reservoir
  { lat: 1.32, lon: 103.7, status: 'future' }, // Jurong Pier
  { lat: 1.348, lon: 103.695, status: 'future' }, // Gek Poh
]
