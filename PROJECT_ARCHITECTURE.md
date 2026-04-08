# Orchestration API - Architecture & Documentation

Welcome to the Orchestration API project! This document serves as a comprehensive onboarding guide for new joiners to understand the architecture, codebase, and integrations of this platform.

> [!NOTE]
> This service functions as an orchestration layer connecting photographers, attendees/visitors, a face recognition engine (CompreFace), and a file storage system (RustFS).

## 1. System Architecture

The application is built around a standard Node.js + Express backend, integrating with a PostgreSQL database and two major external services:

### Core Technologies
- **Runtime**: Node.js
- **Web Framework**: Express.js
- **Database**: PostgreSQL (via `pg` module)
- **Face Recognition**: CompreFace (API communication via `axios`)
- **Storage**: RustFS (S3-compatible, accessed via AWS SDKS `@aws-sdk/client-s3`)
- **Containerization**: Docker & Docker Compose (`docker-compose.yml`)

### High-Level Roles & Workflows

There are two primary personas interacting with the API:

1. **Admin / Photographer**
   - **Authentication**: Uses a static API key (`x-admin-key: <ADMIN_API_KEY>`).
   - **Capabilities**: Can create new **Events**, upload event photos, and get diagnostics.
   - **Flow**: Photographer uploads photos via `POST /upload/:eventId`. The server saves the image file to the **RustFS** bucket, and simultaneously indexes the photo leveraging **CompreFace** to detect and catalog faces.

2. **Visitor / Attendee**
   - **Authentication**: Uses JWTs (`Authorization: Bearer <token>`).
   - **Capabilities**: Can submit a selfie to find photos of themselves from a specific event.
   - **Flow**: Visitor scans a QR Code containing a link to `/events/:eventId/token`. The service generates a JWT for that event, and then redirects them to the frontend (`/visitor`). They click "Search" and upload a selfie. The `POST /search` route identifies the face using CompreFace, checks for matching faces inside that event's bucket, and generates pre-signed RustFS URLs to retrieve and return those photos.

---

## 2. Codebase Structure

The project starts from `src/server.js` and mostly lives in the `src/` directory. Static frontend files are located in the `public/` directory.

### Directory Breakdown

```text
orchestration-api/
├── README.md               # Quickstart deployment instructions
├── docker-compose.yml      # Docker stack definition including DB, env mappings
├── package.json            # Node dependencies
├── public/                 # Static frontends (served by express)
│   ├── admin/              # Admin application shell
│   └── visitor/            # Visitor QR scan destination shell
└── src/
    ├── server.js           # Application entry point binding the Express server to a port
    ├── app.js              # Express app setup, rate-limiting, CORS, routing
    ├── db/                 # Database initialization and client config
    │   ├── client.js       # PostgreSQL DB pool connection file
    │   └── schema.sql      # Database schema mapping (events & indexed_photos)
    ├── middleware/         # Express middlewares
    │   └── auth.js         # Security logic: Admin checking & Visitor JWT issuance/verification 
    ├── routes/             # API Endpoints logic
    │   ├── diagnostics.js  # Diagnostics / metadata endpoints
    │   ├── events.js       # CRUD operations for photographer events
    │   ├── photos.js       # Retrieve available public photos via tokens
    │   ├── search.js       # The magic: taking a visitor selfie and searching it
    │   └── upload.js       # Upload logic for new photos into an event bucket
    └── services/           # Abstractions for External services
        ├── compreface.js   # Wrapper to talk to CompreFace API (detection and similarity algorithms)
        └── rustfs.js       # Wrapper to talk to RustFS storage via S3 Client (upload/signatures)
```

---

## 3. Database Schema

The PostgreSQL database maintains the state and relationship between events and the indexed photos. Find the setup in `src/db/schema.sql`.

- **`events` Table**: Tracks event instances. An event contains `name`, `bucket_name` (assigned to RustFS), and keys matching the isolation level required by CompreFace.
- **`indexed_photos` Table**: Links photos to events, mapping the event (`event_id`) to the specific S3 Object Key (`rustfs_object_id`). It tracks visual metadata such as whether there are faces and a `face_count` to avoid querying blank images in the search phase. 

> [!TIP]
> Always check for the cascade deletion on `event_id` in `indexed_photos`. Deleting an event safely cascades to index deletions.

---

## 4. Key Integrations Walkthrough

### RustFS (`src/services/rustfs.js`)
It implements AWS S3 logic configured through environment inputs `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, and `RUSTFS_SECRET_KEY`.
- Creates and manages buckets corresponding to events.
- Uploads images as Object Blobs.
- Importantly, it signs read URLs using S3 'Presigned URLs' enabling secure public viewing logic for private image files.

### CompreFace (`src/services/compreface.js`)
This facial recognition engine acts as the core of "Selfie Searching":
1. **Detection Phase**: Validates that uploaded selfies possess a face using the generic `POST /api/v1/detection/detect` via the `det_api_key`.
2. **Padding Subroutine**: If a selfie uses the detection phase, it automatically re-crops using `sharp` (Node module) with 30% padding, standardizing data accuracy.
3. **Similarity Search**: Compares the provided selfie buffer with indexed items across an event subset boundary. A carefully tuned `FACE_SIMILARITY_THRESHOLD` environment variable ensures high confidence before reporting a match.

---

## 5. Security & Isolation Model

- **Event Segmentation**: Each event operates semi-independently! 
  - Every event has its specific CompreFace app setup mappings for face data separation avoiding cross-contamination. 
  - Each event has its own S3 subset (`bucket_name`), cleanly categorizing files.
- **Short-Lived Visitor Tokens**: Visitors only get tokens explicitly allowing them to read data correlated to the specific UUID of the event they joined, with a hard `JWT_EXPIRES_IN` limit (e.g. `6h`).

## 6. How to Run Locally

1. Copy `.env.example` to `.env` and fill the variables.
2. Spin up the underlying services via Portainer/Docker according to `README.md`.
3. Use `npm run dev` to start the Node express server locally via `nodemon`. It listens to port `3001`!
