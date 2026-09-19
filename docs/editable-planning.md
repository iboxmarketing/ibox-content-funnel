# Tahrirlanadigan rejalash sozlamalari

Saytdagi **Sozlamalar** bo‘limi doimiy tahrir uchun tegishli Google Sheet tabini ochadi. Saqlangan qiymatlar keyingi 60 soniyalik yangilanishda yoki Refresh bosilganda olinadi. Kanal yaratish uchun `32_CHANNEL_ACCOUNTS` ga noyob ID bilan yangi qator qo‘shing va tayyor bo‘lganda Active ni yoqing. Qoidalarni `20_PUBLISHING_RULES.Channel_Account_ID` orqali ulang.

| Manba | Hisobga ta’siri |
| --- | --- |
| 17 · DEFAULT_WORKING_DAYS, WORK_INTERVALS | Ish kunlari, tanaffuslar, bosqich boshlanishi va tugashi |
| 17 · GLOBAL_WORK_CALENDAR | TRUE bo‘lsa barcha rollarga umumiy ish kunlari |
| 17 · PLANNING_START_DATE | Rejalash oynasining boshlanishi; tasdiqlangan deadline emas |
| 17 · PUBLISH_BUFFER_DAYS, LOCALIZATION_*_DELAY_DAYS | Tayyor bo‘lishdan keyingi ish vaqti buferi |
| 18 · Weekly_Capacity_Hours | Haftalik quvvat va yuklama ogohlantirishlari |
| 19 · Duration_Workdays, Dependency_Stage_ID | Bog‘liq va parallel workflow sanalari |
| 20 · Posts_Per_Week, Preferred_Weekdays, Preferred_Times | Tavsiya etiladigan nashr slotlari |
| 20 · Channel_Account_ID, Weekly_Max, Valid_From, Valid_To | Kanalga bog‘lash va qoida amal qilish davri |
| 21 · Date, Applies_To, Active | Dam olish kunlarini ish vaqtidan chiqarish |
| 32 · Account_Weekly_Max, Account_Minimum_Gap_Minutes | Bir akkauntning barcha qoidalari uchun umumiy limit va interval |

Bo‘sh kanal qatori hisobga olinmaydi. Kanal limiti bo‘sh bo‘lsa qo‘shimcha limit yo‘q, 0 bo‘lsa slot yo‘q. Kanalga hali ulanmagan eski qoidalar platforma bo‘yicha sinov rejasini beradi. Ulangan, ammo faol bo‘lmagan kanal uchun slot berilmaydi. Haqiqiy nashr akkaunti yoki havolasi avtomatik yaratilmaydi.

What-if sinovi faqat brauzer xotirasida. Bir xil override va scheduling natijasi Kanban hamda Calendar’ga beriladi. Reset yoki sahifani yangilash sinovni bekor qiladi. Sinovda task yozuvi o‘chirilgan. Doimiy o‘zgarishlar Sheet’da qilinadi; sayt orqali Head tasdiqlashi va konfiguratsiya versiyasini bazaga saqlash hali ulanmagan.

Workflow’da aniq duration bo‘lsa u ustun; bo‘sh bo‘lsa tegishli DEFAULT_*_DAYS ishlatiladi. WORK_INTERVALS mavjud bo‘lmasa avvalgi DEFAULT_WORK_WINDOWS aliasi qo‘llanadi. Xato sozlama server tomonidan rad etiladi; yuklangan oldingi ma’lumot brauzerda ko‘rinib turadi.

Bu delivery TEST prognozlarini sozlaydi. Task botning haqiqiy bandliklari, kelishilgan muddatlarini o‘zgartirish, Head Apply va versiyalangan task kernel bilan integratsiya alohida ish. Haftalik quvvat modeli haqiqiy xodim vaqtini bron qilmaydi. Schedule_Locked nashr sanalari saqlanadi.

Tekshirish: `npm run test:planning`, `npx tsc --noEmit`. Real Sheet konfiguratsiyasi va ikki mavjud kontent bilan mahalliy UI tekshirildi; QA sahifasi deploy tarkibiga kirmaydi.
