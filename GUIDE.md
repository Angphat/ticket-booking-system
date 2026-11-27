# คู่มือทำโปรเจคระบบจองตั๋วอีเวนต์ (ภาษาไทย)

คู่มือนี้พาทำตั้งแต่เปิดโปรเจคครั้งแรก จนส่งอาจารย์ได้ ทำตามลำดับจากบนลงล่าง ไม่ต้องข้าม

---

## 0. เข้าใจก่อนว่าทำอะไร

**โจทย์อาจารย์:** ทำโปรเจค 1 ตัว แล้วเอาเนื้อหาจาก 3 ลิงก์ไปใช้ในโปรเจคนั้น

**โปรเจคของเรา:** API ระบบจองที่นั่งอีเวนต์ (เหมือนหลังบ้านของเว็บขายบัตรคอนเสิร์ต) ที่ **ไม่มีหน้าเว็บ** ทดสอบผ่านสคริปต์และเทสต์

| ลิงก์อาจารย์ | เราเอาไปใช้ตรงไหน | ไฟล์หลัก |
|---|---|---|
| 1. CI/CD (W3Schools) | push โค้ดขึ้น GitHub แล้วระบบรัน lint + เทสต์ + audit เอง และสร้าง Docker image | `.github/workflows/ci.yml`, `Dockerfile`, `eslint.config.js` |
| 2. Security (GeeksforGeeks) | bcrypt, JWT, rate limit, Helmet, validate input, จำกัดขนาด request | `src/validate.js`, `src/middleware/*`, `src/routes/auth.js`, `src/app.js` |
| 3. Scalability (GeeksforGeeks) | cluster หลาย worker, Redis cache, Winston log, stateless, จัดการ error | `src/cluster.js`, `src/cache.js`, `src/logger.js` |

**จุดเด่นที่เอาไปพูดกับอาจารย์:** ปัญหา "คนแย่งจองที่นั่งเดียวกันพร้อมกัน" ใช้ครบทั้ง 3 เรื่อง เทสต์พิสูจน์ว่าไม่จองซ้ำ (CI/CD), มี rate limit กันบอท (Security), และยังไม่จองซ้ำแม้รันหลาย process (Scalability)

**ความเข้าใจผิดที่เจอบ่อย:** "แอปจองตั๋วทั่วไปก็มีล็อกอินกับเข้ารหัสรหัสผ่านอยู่แล้ว" ถูกครับ ไม่ต้องต่างจากแอปทั่วไป คะแนนอยู่ที่ **หลักฐานว่าเราเอาเนื้อหาจากลิงก์มาใช้จริง** (README + สกรีนช็อต + โค้ด) ไม่ได้อยู่ที่ความแปลกใหม่

---

## 1. เตรียมเครื่อง

ต้องมี:

| สิ่งที่ต้องมี | เช็กยังไง | หมายเหตุ |
|---|---|---|
| **Node.js 22.13 ขึ้นไป** | `node -v` | ต่ำกว่า 22 ใช้ไม่ได้ เพราะโปรเจคใช้ `node:sqlite` ที่ติดมากับ Node ดาวน์โหลดที่ nodejs.org (เลือก LTS ล่าสุด) |
| **Git** | `git --version` | |
| **บัญชี GitHub** | | ใช้ตอนทำ CI/CD |
| Docker Desktop | `docker -v` | **ไม่บังคับ** ใช้เฉพาะส่วนทดลอง Redis |

ถ้า `node -v` ขึ้นเวอร์ชันต่ำกว่า 22.13 ให้อัปเดตก่อน ไม่งั้นเทสต์จะ error ว่าหา `node:sqlite` ไม่เจอ

> ผู้ใช้ Windows: ใช้ **Git Bash** หรือ PowerShell ก็ได้ คำสั่งที่ต่างกันผมระบุไว้ให้

---

## 2. ติดตั้ง (ครั้งแรก)

แตก zip แล้วเปิดเทอร์มินัลในโฟลเดอร์ `ticket-booking-system`

```bash
npm install
```

คำสั่งนี้ทำ 2 อย่าง คือโหลดแพ็กเกจ และสร้างไฟล์ **`package-lock.json`**

> **สำคัญมาก:** ไฟล์ `package-lock.json` ต้องถูก commit ขึ้น GitHub ด้วย เพราะ GitHub Actions ใช้ `npm ci` ซึ่งบังคับให้มีไฟล์นี้ ถ้าไม่มี pipeline จะล้มตั้งแต่ขั้นแรก

สร้างไฟล์ตั้งค่า:

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# Windows PowerShell
copy .env.example .env
```

สร้างรหัสลับ (JWT_SECRET) แล้วเอาไปแทนค่าในไฟล์ `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

เปิด `.env` แก้บรรทัด `JWT_SECRET=...` เป็นค่าที่ได้ และตั้ง `ADMIN_PASSWORD` เป็นรหัสผ่านที่คุณจำได้ (8 ตัวขึ้นไป)

> ไฟล์ `.env` ห้ามขึ้น GitHub (ถูกกันไว้ใน `.gitignore` แล้ว) นี่คือข้อ "เก็บ secret นอกโค้ด" ในบทความ Security

---

## 3. รันเทสต์ (ส่วน CI/CD)

```bash
npm test
```

**ผลที่ควรเห็น:** ท้ายผลลัพธ์ต้องเป็น

```
# tests 46
# pass 46
# fail 0
```

จะมีคำเตือน `ExperimentalWarning: SQLite is an experimental feature` ขึ้นมา **ไม่ใช่ error** ปกติ

**เทสต์พวกนี้พิสูจน์อะไร** (เอาไปเล่าอาจารย์ได้):

- จองที่นั่งซ้ำไม่ได้ ทั้งคนละ user และ user เดียวกัน
- หลาย process แย่งที่นั่งเดียวกันพร้อมกัน → ชนะได้แค่คนเดียว
- user จองได้ไม่เกิน 4 ที่นั่งต่ออีเวนต์ แม้ส่งคำขอพร้อมกัน
- ล็อกอินผิดรัวๆ ถูกบล็อก (429)
- รหัสผ่านในฐานข้อมูลเป็น hash
- user ธรรมดาสร้างอีเวนต์ไม่ได้ (403), ยกเลิกการจองของคนอื่นไม่ได้
- ข้อความ SQL injection ถูกเก็บเป็นข้อความธรรมดา ไม่ทำลายตาราง

**ถ้าเทสต์ล้ม:** คัดลอกข้อความ error ส่วนที่ขึ้นหัวว่า `not ok` มาให้ผมดู อย่าเดาแก้เอง

ตรวจสไตล์โค้ด:

```bash
npm run lint
```

ต้องไม่มี error ขึ้น (ถ้าเงียบแปลว่าผ่าน)

---

## 4. รันเซิร์ฟเวอร์และดูผล (ส่วน Security)

เปิดเทอร์มินัล **สองหน้าต่าง**

**หน้าต่าง 1: เตรียมข้อมูลแล้วเปิดเซิร์ฟเวอร์**

```bash
npm run seed
npm start
```

`seed` สร้างแอดมินและอีเวนต์ตัวอย่าง 3 ตัว ส่วน `start` เปิดเซิร์ฟเวอร์ที่ http://localhost:3000 ต้องเห็นบรรทัด `server listening on port 3000`

**หน้าต่าง 2: รันสคริปต์สาธิต**

```bash
npm run demo -- --bruteforce
```

**ผลที่ควรเห็น และมันพิสูจน์อะไร:**

| บรรทัดในผลลัพธ์ | พิสูจน์เรื่อง |
|---|---|
| `GET /api/events` ครั้งแรก `X-Cache: MISS` ครั้งที่สอง `X-Cache: HIT` | Redis/ memory cache ทำงาน (Scalability) |
| `Register with a weak password` → HTTP 400 | validate input (Security #1) |
| `Book without a token` → HTTP 401 | ต้องล็อกอินก่อนจอง (Security #8) |
| `Alice books seat N` → 201, `Bob tries the SAME seat` → **409** | จองซ้ำไม่ได้ |
| `Bob (not an admin) tries to create an event` → **403** | แยกสิทธิ์ผู้ใช้/แอดมิน (Security #8) |
| `Security headers set by Helmet` | Helmet (Security #7) |
| `attempt 11 -> HTTP 429` | rate limit กัน brute force (Security #3) |

ดูรหัสผ่านที่เก็บจริงในฐานข้อมูล:

```bash
npm run users
```

จะเห็น `password_hash: $2a$10$...` เป็นข้อความอ่านไม่ออก ไม่ใช่รหัสผ่านจริง (hash ย้อนกลับไม่ได้ ต่างจากการเข้ารหัสที่ถอดกลับได้)

> ถ้ารัน `demo` ซ้ำหลังโดน 429 แล้วล็อกอินไม่ผ่าน ให้กด Ctrl+C ที่หน้าต่าง 1 แล้ว `npm start` ใหม่ ตัวนับจะรีเซ็ต

---

## 5. โหมด cluster และการแย่งจอง (ส่วน Scalability)

หน้าต่าง 1: กด Ctrl+C หยุดเซิร์ฟเวอร์เดิม แล้วรัน

```bash
npm run start:cluster
```

จะเห็นข้อความ `starting N workers` (N = จำนวนแกน CPU) และคำเตือนว่ายังไม่ได้ตั้ง `REDIS_URL` ซึ่งปกติ

หน้าต่าง 2:

```bash
npm run race -- 30
```

**ผลที่ควรเห็น:**

```
Results by HTTP status: { '201': 1, '409': 29 }
Answered by 3 different process(es): ...
PASS: exactly one booking succeeded, no double booking.
```

นี่คือภาพสำคัญที่สุดของโปรเจค: 30 คนแย่งที่นั่งเดียวกัน ได้ 1 คน และมีหลาย process ช่วยตอบ

**ทำไมถึงไม่จองซ้ำ** (ต้องอธิบายได้): ใน `src/services/store.js` ฟังก์ชัน `bookSeat` ใช้ 2 ชั้นป้องกัน

1. `BEGIN IMMEDIATE` ล็อกฐานข้อมูลให้เขียนได้ทีละ process
2. ตารางมี `UNIQUE (event_id, seat)` ถ้าหลุดมาได้ ฐานข้อมูลก็ปฏิเสธเอง

**สิ่งที่ต้องรู้ (อย่าตกใจ):** ในโหมด cluster **ไม่มี Redis** จะไม่ค่อยเห็น `X-Cache: HIT` และ rate limit จะบล็อกช้ากว่า (ราวครั้งที่ 21 แทนที่จะเป็น 11 เมื่อมี 3 worker) เพราะแต่ละ worker มีตัวนับและ cache ของตัวเอง เป็นข้อจำกัดที่เขียนไว้ใน README หัวข้อ *Limitations* แล้ว ถ้าอาจารย์ถาม ตอบได้ว่า "รู้ และแก้ได้ด้วย Redis store"

### ทดลองกับ Redis จริง (ต้องมี Docker, ไม่บังคับ)

ตั้ง `ADMIN_PASSWORD` ในไฟล์ `.env` ก่อน แล้ว:

```bash
docker compose up --build
```

เปิดอีกหน้าต่าง:

```bash
docker compose exec app node scripts/seed.js
docker compose exec app node scripts/demo.js
docker compose exec app node scripts/race-test.js 20
```

คราวนี้ `/health` จะขึ้น `"cache":"redis"` และ `X-Cache: HIT` จะขึ้นแม้รันหลาย worker เพราะทุก worker ใช้ Redis ตัวเดียวกัน หยุดด้วย Ctrl+C แล้ว `docker compose down`

### ทดลองวัดความเร็ว cache (ไม่บังคับ)

ดูหัวข้อ "Optional load test" ใน README ต้องเพิ่มค่า `limits.global` ใน `src/config.js` ชั่วคราว ไม่งั้น rate limit จะบล็อกการทดสอบเอง

---

## 6. ขึ้น GitHub และดู pipeline ทำงาน (ส่วน CI/CD)

1. เข้า github.com → New repository → ตั้งชื่อเช่น `ticket-booking-system` → **ไม่ต้องติ๊ก** Add README/.gitignore → Create
2. ในโฟลเดอร์โปรเจค:

```bash
git init
git add .
git status
```

ตรวจรายการ `git status` ให้แน่ใจว่า **มี** `package-lock.json` และ **ไม่มี** `.env`, `node_modules`, `data`, `logs`

```bash
git commit -m "Initial commit: ticket booking API"
git branch -M main
git remote add origin https://github.com/<ชื่อผู้ใช้>/<ชื่อ repo>.git
git push -u origin main
```

3. เปิดแท็บ **Actions** ใน repo จะเห็น workflow "CI/CD" กำลังรัน

**ผลที่ควรเห็น:**

| Job | ผลที่ถูกต้อง |
|---|---|
| `Test (Node 22.x)` และ `Test (Node 24.x)` | ติ๊กเขียว (lint → test → audit) |
| `Build and publish Docker image (staging)` | ติ๊กเขียว |
| `Promote image to production` | ติ๊กเขียว |

4. ดู Docker image ที่ถูกสร้าง: หน้าแรกของ repo → แถบขวา **Packages**

### ตั้งให้ production ต้องรออนุมัติ (ตามบทความ: manual approval)

Settings → **Environments** → `production` → ติ๊ก **Required reviewers** → ใส่ชื่อตัวเอง → Save

push ครั้งต่อไป job `Promote image to production` จะหยุดรอ มีปุ่ม **Review deployments** ให้กดอนุมัติ ถ่ายภาพหน้านี้ไว้เป็นหลักฐาน

### ทำให้เห็นตอนเทสต์ล้ม (ภาพประกอบที่ดี)

```bash
git checkout -b demo-fail
```

แก้เทสต์ 1 ข้อให้ผิดโดยตั้งใจ เช่นใน `tests/store.test.js` ในเทสต์ `counts seats in the event list` เปลี่ยนบรรทัด `assert.equal(listed.totalSeats, 10);` เป็น `assert.equal(listed.totalSeats, 99);` แล้ว:

```bash
git commit -am "Break a test on purpose"
git push -u origin demo-fail
```

เปิด Pull Request ที่ GitHub จะเห็น **เครื่องหมาย X สีแดง** ว่า CI บล็อกโค้ดที่เทสต์ไม่ผ่าน ถ่ายภาพ แล้วแก้กลับ push ใหม่จะกลับเป็นสีเขียว (จากนั้น merge หรือทิ้ง branch ก็ได้)

### ถ้า pipeline ล้ม

| อาการ | วิธีแก้ |
|---|---|
| `npm ci` ล้ม บอกว่าไม่มี package-lock.json | ลืม commit ไฟล์นี้ รัน `git add package-lock.json` แล้ว commit/push |
| ขั้น lint ล้ม | รัน `npm run lint` ในเครื่อง อ่านบรรทัดที่ error แล้วแก้ |
| ขั้น `npm audit` ล้ม | รัน `npm audit` ดูรายละเอียด ลอง `npm audit fix` แล้ว commit ไฟล์ lock ใหม่ |
| job staging ล้มด้วย `denied` หรือ permission | Settings → Actions → General → Workflow permissions → เลือก **Read and write permissions** |
| เทสต์ผ่านในเครื่องแต่ล้มบน Actions | ส่งข้อความ error ในหน้า Actions มาให้ผมดู |

---

## 7. เขียน README ส่งอาจารย์

ไฟล์ `README.md` เขียนไว้ให้แล้ว (ภาษาอังกฤษ ตรงกับภาษาที่อาจารย์ใช้) ที่ต้องทำมีแค่:

1. แก้บรรทัดบนสุด: ใส่ **ชื่อคุณ, ชื่อวิชา, ลิงก์ GitHub repo**
2. อ่านให้เข้าใจทุกตาราง โดยเฉพาะหัวข้อ 1–3 ที่เทียบ "เนื้อหาจากบทความ" กับ "ไฟล์ในโปรเจค"
3. ตรวจว่าตัวเลข เช่น "46 tests" ตรงกับที่คุณรันได้จริง

**สกรีนช็อตที่ควรแนบ** (แบ่งตามลิงก์ของอาจารย์):

| ลิงก์ | ภาพที่ควรมี |
|---|---|
| CI/CD | หน้า Actions ติ๊กเขียวทั้งหมด, (ถ้าทำ) ภาพ X สีแดงตอนเทสต์ล้ม, หน้า Review deployments, หน้า Packages ที่มี image |
| Security | `npm run demo -- --bruteforce` (401/403/409/429 + Helmet headers), `npm run users` (เห็น hash) |
| Scalability | `npm run race -- 30` (1 สำเร็จ + PASS + หลาย process), `/health` ขึ้น `"cache":"redis"` (ถ้าทำ Docker), `X-Cache: HIT` |

---

## 8. เตรียมตอบอาจารย์

อาจารย์อาจถามสั้นๆ ประมาณนี้ ลองตอบด้วยคำพูดตัวเอง:

1. **"โปรเจคนี้เชื่อมกับ 3 ลิงก์ยังไง"** → เปิดตารางใน README หัวข้อ 1–3 ชี้ว่าแต่ละข้อในบทความอยู่ไฟล์ไหน
2. **"จองซ้ำไม่ได้ได้ยังไง"** → `BEGIN IMMEDIATE` + `UNIQUE (event_id, seat)` และเทสต์ `concurrency.test.js` ที่ใช้หลาย process จริง
3. **"hash ต่างจากเข้ารหัสยังไง"** → hash ย้อนกลับไม่ได้ ตรวจรหัสผ่านโดย hash ค่าที่ผู้ใช้กรอกแล้วเทียบกัน
4. **"ทำไมใช้ cluster"** → Node รันบนแกน CPU เดียวต่อ process จึงเปิดหลาย worker ให้ใช้ทุกแกน และ primary กระจายคำขอ
5. **"ทำไมไม่ใช้ Nginx / microservices"** → SQLite เป็นไฟล์บนเครื่องเดียว กระจายหลายเครื่องต้องใช้ฐานข้อมูลแบบเครือข่าย (เช่น PostgreSQL) ซึ่งอยู่นอกขอบเขตงาน เขียนเป็น Limitations ไว้แล้ว
6. **"อะไรที่ยังไม่ได้ทำ"** → ตอบตรงๆ ตามหัวข้อ Limitations ใน README (MFA, รีเซ็ตรหัสผ่าน, หน้าเว็บ ฯลฯ) การบอกข้อจำกัดเองได้ดีกว่าให้อาจารย์หาเจอ

---

## 9. แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Cannot find module 'node:sqlite'` | Node เก่าเกินไป ต้อง 22.13 ขึ้นไป (`node -v`) |
| `JWT_SECRET is not set` | ยังไม่ได้สร้าง `.env` หรือยังไม่ได้ใส่ค่า (ข้อ 2) |
| `EADDRINUSE: address already in use :::3000` | มีเซิร์ฟเวอร์ตัวเก่ายังรันอยู่ ปิดด้วย Ctrl+C หรือเปลี่ยน `PORT` ใน `.env` |
| `Demo failed. Is the server running?` | ยังไม่ได้เปิดเซิร์ฟเวอร์ในอีกหน้าต่าง |
| `No events found` | ยังไม่ได้รัน `npm run seed` |
| `npm run race` ได้ `401`/ล็อกอินไม่ผ่าน | สคริปต์กับเซิร์ฟเวอร์ต้องใช้ `DB_FILE` ไฟล์เดียวกัน (ปกติเป็นค่าเริ่มต้นเดียวกันอยู่แล้ว) |
| ได้ 429 ตลอดตอนทดลอง | โดน rate limit อยู่ restart เซิร์ฟเวอร์เพื่อรีเซ็ตตัวนับ |
| `docker compose up` แจ้ง `Set JWT_SECRET in the .env file` | ยังไม่ได้ใส่ `JWT_SECRET` ใน `.env` |
| Windows: คำสั่ง `cp` ไม่รู้จัก | ใช้ `copy` หรือเปิด Git Bash |

---

## 10. สิ่งที่ผมตรวจแล้ว และสิ่งที่คุณต้องตรวจเอง

เพื่อความตรงไปตรงมา:

**ตรวจแล้วจริง** (รันบน Node 22 ในเครื่องของผม):
- เทสต์ตรรกะจอง, การแย่งจองข้ามหลาย process, validation, cache, config รันผ่านทุกข้อ ซ้ำหลายรอบโดยไม่สุ่มพลาด
- ตรวจ syntax ทุกไฟล์

**ตรวจได้เพียงบางส่วน:** เครื่องของผมติดตั้งแพ็กเกจ npm ไม่ได้ (express, helmet, bcryptjs ฯลฯ) ผมจึงรันชั้น HTTP ทั้งหมด (เทสต์ API 16 ข้อ, เซิร์ฟเวอร์ cluster 3 worker, สคริปต์ demo และ race) กับ **ตัวจำลองที่ผมเขียนเอง** แทนไลบรารีจริง ซึ่งยืนยันได้ว่าโค้ดของผมต่อกันถูกต้อง แต่ **ไม่ได้ยืนยันพฤติกรรมของไลบรารีจริง** และผมไม่ได้รัน ESLint, `docker build` และ GitHub Actions จริง

**ดังนั้นสิ่งแรกที่ต้องทำเมื่อเปิดโปรเจค คือ `npm install` ตามด้วย `npm test` และ `npm run lint`** ถ้ามีข้อไหนล้ม ส่งข้อความ error มาให้ผม ผมจะแก้ให้ตรงจุด
