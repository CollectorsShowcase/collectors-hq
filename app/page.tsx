"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
/* =============================================================================
   SECTION 1) TYPES (Data models used across the page)
============================================================================= */

type Condition = "Carded" | "Loose";
type ListingStatus = "NONE" | "TRADE" | "SALE" | "BOTH";

type PrivacyMode = "PRIVATE" | "SHOWROOM" | "PUBLIC";
type AccessLevel = "NONE" | "SHOWROOM" | "FULL";

type DMReason = "Trade" | "Buy" | "Sell" | "Question" | "Other";

type MediaKind = "image" | "video";

type MediaItem = {
  id: string;
  kind: "image" | "video";
  dataUrl?: string;      // demo/local
  storagePath?: string;  // supabase storage path
  fileName?: string;
  createdAt: number;
};

type Car = {
  id: string;
  name: string;
  brand: string;
  scale?: string;
  year?: string;
  series?: string;
  caseCode?: string;
  condition: Condition;
  notes?: string;
  quantityOwned: number;
  quantityAvailableTrade: number;
  quantityAvailableSale: number;
  listingStatus: ListingStatus;
  media?: MediaItem[];

};

type AccessRequest = {
  id: string;
  viewerId: string;
  requested: "SHOWROOM" | "FULL";
  note: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: number;
};

type DMRequest = {
  id: string;
  viewerId: string;
  reason: DMReason;
  note: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: number;
  conversationId?: string; // link to thread created on approval
};

type Conversation = {
  id: string;
  ownerId: string;
  viewerId: string;
  createdAt: number;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string; // OWNER_ID or VIEWER_ID
  body: string;
  createdAt: number;
};


/* =============================================================================
   SECTION 2) CONSTANTS (IDs + localStorage keys)
============================================================================= */

const OWNER_ID = "diecastdan";
const VIEWER_ID = "visitor-001"; // later: session.user.id

const STORAGE_CARS = "collectorshq:cars:v1";
const STORAGE_PRIVACY = "collectorshq:privacy:v1";
const STORAGE_GRANTS = "collectorshq:grants_by_viewer:v1";
const STORAGE_ACCESS_REQS = "collectorshq:access_requests:v1";
const STORAGE_DM_REQS = "collectorshq:dm_requests:v1";
const STORAGE_DM_APPROVED_BY_VIEWER = "collectorshq:dm_approved_by_viewer:v1";
const STORAGE_CONVERSATIONS = "collectorshq:conversations:v1";
const STORAGE_MESSAGES = "collectorshq:messages:v1";

/* =============================================================================
   SECTION 3) HELPERS (safe parsing + small utilities)
============================================================================= */

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clampInt(n: unknown, min = 0, max = 9999) {
  const num =
    typeof n === "number" ? n : typeof n === "string" ? parseInt(n, 10) : 0;
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function computeStatus(tradeAvail: number, saleAvail: number): ListingStatus {
  if (tradeAvail > 0 && saleAvail > 0) return "BOTH";
  if (tradeAvail > 0) return "TRADE";
  if (saleAvail > 0) return "SALE";
  return "NONE";
}

function safeParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeParseCars(raw: string | null): Car[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c: any) => {
        if (!c || typeof c !== "object") return null;
        if (typeof c.id !== "string" || typeof c.name !== "string") return null;
        if (typeof c.brand !== "string") return null;

        const quantityOwned = clampInt(c.quantityOwned);
        const quantityAvailableTrade = clampInt(c.quantityAvailableTrade);
        const quantityAvailableSale = clampInt(c.quantityAvailableSale);

        const media: MediaItem[] | undefined = Array.isArray(c.media)
  ? (c.media
      .map((m: any) => {
        if (!m || typeof m !== "object") return null;
        if (typeof m.id !== "string") return null;
        if (m.kind !== "image" && m.kind !== "video") return null;

        const dataUrl = typeof m.dataUrl === "string" ? m.dataUrl : undefined;
        const storagePath =
          typeof m.storagePath === "string" ? m.storagePath : undefined;

        // must have at least one source
        if (!dataUrl && !storagePath) return null;

        return {
          id: m.id,
          kind: m.kind,
          dataUrl,
          storagePath,
          fileName: typeof m.fileName === "string" ? m.fileName : undefined,
          createdAt: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
        } as MediaItem;
      })
      .filter(Boolean) as MediaItem[])
  : undefined;

return {
  id: c.id,
  name: c.name,
  brand: c.brand,
  scale: typeof c.scale === "string" ? c.scale : undefined,
  year: typeof c.year === "string" ? c.year : undefined,
  series: typeof c.series === "string" ? c.series : undefined,
  caseCode: typeof c.caseCode === "string" ? c.caseCode : undefined,
  condition: c.condition === "Loose" ? "Loose" : "Carded",
  notes: typeof c.notes === "string" ? c.notes : undefined,
  quantityOwned,
  quantityAvailableTrade,
  quantityAvailableSale,
  listingStatus: computeStatus(quantityAvailableTrade, quantityAvailableSale),
  media,
} as Car;
      })
      .filter(Boolean) as Car[];
  } catch {
    return [];
  }
}

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function show(v?: string) {
  return v && v.trim() ? v : "—";
}
function convoIdForPair(ownerId: string, viewerId: string) {
  return `convo:${ownerId}::${viewerId}`;
}

function upsertConversation(prev: Conversation[], convo: Conversation) {
  const exists = prev.some((c) => c.id === convo.id);
  return exists ? prev : [convo, ...prev];
}
const MAX_MEDIA_ITEMS = 6;
const MAX_MEDIA_BYTES = 900_000; // ~0.9MB each

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function guessKind(file: File): MediaKind {
  return file.type.startsWith("video/") ? "video" : "image";
}
function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

const supabase = createClient(
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Put your bucket name here:
const MEDIA_BUCKET = "car-media";

/**
 * Returns a usable URL for rendering in <img> / <video>.
 * - Demo/local: uses dataUrl
 * - Supabase: uses public URL from storagePath
 */
function getMediaSrc(m: MediaItem) {
  if (m.dataUrl) return m.dataUrl;

  if (m.storagePath) {
    // Works if bucket is PUBLIC (recommended for demo)
   // const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(m.storagePath);
    //return data.publicUrl;
    return "";
  }

  return "";
}


/* =============================================================================
   SECTION 4) SMALL UI COMPONENTS (Buttons/badges)
============================================================================= */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] text-white">
      {children}
    </span>
  );
}

function ActionBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
        "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 " +
        className
      }
    />
  );
}

function PillBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
  const { className = "", active, ...rest } = props;
  return (
    <button
      {...rest}
      className={
        `rounded-full px-4 py-2 text-sm ${
          active ? "bg-white/10" : "bg-white/5 hover:bg-white/10"
        } ` + className
      }
    />
  );
}

/* =============================================================================
   SECTION 5) ACCESS LOGIC (“brain”)
   Your rules:
   - NONE: cannot DM
   - SHOWROOM: can request DM (note <= 200 words), owner approves → then can DM
   - FULL: can DM anytime, no request needed
============================================================================= */

function getEffectiveAccess(args: {
  isOwner: boolean;
  privacyMode: PrivacyMode;
  granted: AccessLevel; // viewer-specific grant
}): AccessLevel {
  const { isOwner, privacyMode, granted } = args;

  if (isOwner) return "FULL";
  if (privacyMode === "PUBLIC") return "FULL";

  if (granted === "FULL") return "FULL";
  if (granted === "SHOWROOM") return "SHOWROOM";

  if (privacyMode === "SHOWROOM") return "SHOWROOM";

  return "NONE"; // PRIVATE with no grant
}

/* =============================================================================
   SECTION 6) MAIN PAGE
============================================================================= */

export default function Home() {
  /* ---------------------------------------------------------------------------
     SECTION 6A) Demo view switch (remove when you add real auth)
  --------------------------------------------------------------------------- */
  const [viewAs, setViewAs] = useState<"OWNER" | "VISITOR">("OWNER");
  const isOwner = viewAs === "OWNER";

  /* ---------------------------------------------------------------------------
     SECTION 6B) Primary UI state
  --------------------------------------------------------------------------- */
  const [tab, setTab] = useState<"showroom" | "catalog" | "trade">("showroom");
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("SHOWROOM");

  /* ---------------------------------------------------------------------------
     SECTION 6C) Viewer-specific access + DM approvals (scales to many viewers)
  --------------------------------------------------------------------------- */
  const [grantedAccessByViewer, setGrantedAccessByViewer] = useState<Record<string, AccessLevel>>(
    {}
  );
  const [dmApprovedByViewer, setDmApprovedByViewer] = useState<Record<string, boolean>>({});

  const viewerGrant = grantedAccessByViewer[VIEWER_ID] ?? "NONE";
  const viewerDmApproved = dmApprovedByViewer[VIEWER_ID] ?? false;

  const accessLevel = getEffectiveAccess({
    isOwner,
    privacyMode,
    granted: viewerGrant,
  });

  /* ---------------------------------------------------------------------------
     SECTION 6D) Cars
  --------------------------------------------------------------------------- */
  const [cars, setCars] = useState<Car[]>([
    {
      id: "1",
      name: "Nissan Skyline GT-R (R34)",
      brand: "Hot Wheels",
      scale: "1:64",
      year: "2023",
      series: "HW J-Imports",
      caseCode: "K",
      condition: "Loose",
      notes: "Variant notes, condition details, why it matters…",
      quantityOwned: 3,
      quantityAvailableTrade: 0,
      quantityAvailableSale: 0,
      listingStatus: "NONE",
    },
    {
      id: "2",
      name: "M3 GTR",
      brand: "Hot Wheels",
      scale: "1:64",
      year: "2025",
      series: "HW Flames",
      caseCode: "P",
      condition: "Carded",
      notes: "",
      quantityOwned: 1,
      quantityAvailableTrade: 0,
      quantityAvailableSale: 0,
      listingStatus: "NONE",
    },
    {
      id: "3",
      name: "Porsche 911 GT3",
      brand: "Matchbox",
      scale: "1:64",
      year: "2022",
      series: "Collector",
      caseCode: undefined,
      condition: "Carded",
      notes: "Have multiple; one is trade-ready.",
      quantityOwned: 3,
      quantityAvailableTrade: 1,
      quantityAvailableSale: 1,
      listingStatus: "BOTH",
    },
  ]);

  /* ---------------------------------------------------------------------------
     SECTION 6E) Requests + Chat data
  --------------------------------------------------------------------------- */
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [dmRequests, setDmRequests] = useState<DMRequest[]>([]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  /* ---------------------------------------------------------------------------
     SECTION 6F) Modal state
  --------------------------------------------------------------------------- */
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);

  const [accessReqOpen, setAccessReqOpen] = useState(false);
  const [dmReqOpen, setDmReqOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);

  // Chat modal
  const [chatOpen, setChatOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------------------------------------------------------
     SECTION 6G) ESC closes modals
  --------------------------------------------------------------------------- */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setSelectedCar(null);
      setAddOpen(false);
      setAccessReqOpen(false);
      setDmReqOpen(false);
      setInboxOpen(false);
      setChatOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ---------------------------------------------------------------------------
     SECTION 6H) Load from localStorage (once)
  --------------------------------------------------------------------------- */
  useEffect(() => {
    const savedCars = safeParseCars(localStorage.getItem(STORAGE_CARS));
    if (savedCars.length > 0) setCars(savedCars);

    const savedPrivacy = safeParseJSON<PrivacyMode>(
      localStorage.getItem(STORAGE_PRIVACY),
      "SHOWROOM"
    );
    setPrivacyMode(savedPrivacy);

    setGrantedAccessByViewer(
      safeParseJSON<Record<string, AccessLevel>>(localStorage.getItem(STORAGE_GRANTS), {})
    );

    setAccessRequests(
      safeParseJSON<AccessRequest[]>(localStorage.getItem(STORAGE_ACCESS_REQS), [])
    );

    setDmRequests(
      safeParseJSON<DMRequest[]>(localStorage.getItem(STORAGE_DM_REQS), [])
    );

    setDmApprovedByViewer(
      safeParseJSON<Record<string, boolean>>(
        localStorage.getItem(STORAGE_DM_APPROVED_BY_VIEWER),
        {}
      )
    );

    setConversations(
      safeParseJSON<Conversation[]>(localStorage.getItem(STORAGE_CONVERSATIONS), [])
    );

    setMessages(
      safeParseJSON<Message[]>(localStorage.getItem(STORAGE_MESSAGES), [])
    );
  }, []);

  /* ---------------------------------------------------------------------------
     SECTION 6I) Persist to localStorage (on change)
  --------------------------------------------------------------------------- */
  useEffect(() => {
    localStorage.setItem(STORAGE_CARS, JSON.stringify(cars));
  }, [cars]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PRIVACY, JSON.stringify(privacyMode));
  }, [privacyMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_GRANTS, JSON.stringify(grantedAccessByViewer));
  }, [grantedAccessByViewer]);

  useEffect(() => {
    localStorage.setItem(STORAGE_ACCESS_REQS, JSON.stringify(accessRequests));
  }, [accessRequests]);

  useEffect(() => {
    localStorage.setItem(STORAGE_DM_REQS, JSON.stringify(dmRequests));
  }, [dmRequests]);

  useEffect(() => {
    localStorage.setItem(STORAGE_DM_APPROVED_BY_VIEWER, JSON.stringify(dmApprovedByViewer));
  }, [dmApprovedByViewer]);

  useEffect(() => {
    localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
  }, [messages]);

  /* ---------------------------------------------------------------------------
   SECTION 6J) Add car form (owner)
--------------------------------------------------------------------------- */
const [uploading, setUploading] = useState(false);

const [form, setForm] = useState({
  name: "",
  brand: "",
  scale: "",
  year: "",
  series: "",
  caseCode: "",
  condition: "Carded" as Condition,
  notes: "",
  quantityOwned: 1,
  quantityAvailableTrade: 0,
  quantityAvailableSale: 0,
  media: [] as MediaItem[],
});

  function resetForm() {
    setForm({
      name: "",
      brand: "",
      scale: "",
      year: "",
      series: "",
      caseCode: "",
      condition: "Carded",
      notes: "",
      quantityOwned: 1,
      quantityAvailableTrade: 0,
      quantityAvailableSale: 0,
      media: [],
    });
  }

  function openAdd() {
    resetForm();
    setAddOpen(true);
  }
  async function addMediaFiles(files: FileList | null) {
  if (!files) return;

  setUploading(true);
  try {
    const incoming = Array.from(files);
    const room = Math.max(0, MAX_MEDIA_ITEMS - form.media.length);
    const slice = incoming.slice(0, room);

    const nextItems: MediaItem[] = [];

    for (const f of slice) {
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
        alert(`"${f.name}" is not an image or video.`);
        continue;
      }

      if (f.size > MAX_MEDIA_BYTES) {
        alert(`"${f.name}" is too large for demo. Keep files under ~0.9MB.`);
        continue;
      }

      const kind: "image" | "video" = f.type.startsWith("video/") ? "video" : "image";

      const path = `${OWNER_ID}/${Date.now()}-${uid()}-${safeFileName(f.name)}`;

      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, f, { contentType: f.type, upsert: false });

      if (error) {
        alert(`Upload failed: ${error.message}`);
        continue;
      }

      nextItems.push({
        id: uid(),
        kind,
        storagePath: path,
        fileName: f.name,
        createdAt: Date.now(),
      });
    }

    if (nextItems.length) {
      setForm((prev) => ({ ...prev, media: [...prev.media, ...nextItems] }));
    }
  } finally {
    setUploading(false);
  }
}



async function removeMedia(id: string) {
  const item = form.media.find((m) => m.id === id);

  // remove from UI immediately
  setForm((prev) => ({ ...prev, media: prev.media.filter((m) => m.id !== id) }));

  // also delete from Supabase (if it was uploaded)
  if (item?.storagePath) {
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .remove([item.storagePath]);

    if (error) {
      console.warn("Failed to delete from storage:", error.message);
    }
  }
}

  function saveNewCar() {
    const name = form.name.trim();
    if (!name) return alert("Please enter a car name.");

    const brand = form.brand.trim();
    if (!brand) return alert("Please enter a brand (Hot Wheels / Matchbox / MiniGT).");

    const scale = form.scale.trim() || undefined;
    const year = form.year.trim() || undefined;
    const series = form.series.trim() || undefined;
    const caseCode = form.caseCode.trim() || undefined;
    const notes = form.notes.trim() || undefined;

    const owned = clampInt(form.quantityOwned);
    let tradeAvail = clampInt(form.quantityAvailableTrade);
    let saleAvail = clampInt(form.quantityAvailableSale);

    tradeAvail = Math.min(tradeAvail, owned);
    saleAvail = Math.min(saleAvail, owned);

    if (owned === 0) {
      tradeAvail = 0;
      saleAvail = 0;
    }

    const newCar: Car = {
      id: uid(),
      name,
      brand,
      scale,
      year,
      series,
      caseCode,
      condition: form.condition,
      notes,
      quantityOwned: owned,
      quantityAvailableTrade: tradeAvail,
      quantityAvailableSale: saleAvail,
      listingStatus: computeStatus(tradeAvail, saleAvail),
      media: form.media.length ? form.media : undefined,
    };

    setCars((prev) => [newCar, ...prev]);
    setAddOpen(false);
    setTab("showroom");
  }

  /* ---------------------------------------------------------------------------
     SECTION 6K) Derived stats
  --------------------------------------------------------------------------- */
  const tradeCars = useMemo(
    () =>
      cars.filter(
        (c) => c.listingStatus === "TRADE" || c.listingStatus === "SALE" || c.listingStatus === "BOTH"
      ),
    [cars]
  );

  const totalOwned = useMemo(() => cars.reduce((sum, c) => sum + c.quantityOwned, 0), [cars]);

  const totalForTrade = useMemo(
    () => tradeCars.reduce((sum, c) => sum + c.quantityAvailableTrade, 0),
    [tradeCars]
  );

  const totalForSale = useMemo(
    () => tradeCars.reduce((sum, c) => sum + c.quantityAvailableSale, 0),
    [tradeCars]
  );

  /* ---------------------------------------------------------------------------
     SECTION 6L) Access request modal (visitors with NONE)
  --------------------------------------------------------------------------- */
  const [accessReqLevel, setAccessReqLevel] = useState<"SHOWROOM" | "FULL">("SHOWROOM");
  const [accessReqNote, setAccessReqNote] = useState("");

  function submitAccessRequest() {
    if (wordCount(accessReqNote) > 100) return alert("Please keep the note within 100 words.");

    const hasPendingAccess = accessRequests.some(
      (r) => r.viewerId === VIEWER_ID && r.status === "PENDING"
    );
    if (hasPendingAccess) return alert("You already have a pending access request.");

    const req: AccessRequest = {
      id: uid(),
      viewerId: VIEWER_ID,
      requested: accessReqLevel,
      note: accessReqNote.trim(),
      status: "PENDING",
      createdAt: Date.now(),
    };

    setAccessRequests((prev) => [req, ...prev]);
    setAccessReqOpen(false);
    setAccessReqNote("");
    setAccessReqLevel("SHOWROOM");
    alert("Access request sent (demo). Owner can approve/decline in Inbox.");
  }

  /* ---------------------------------------------------------------------------
     SECTION 6M) DM request modal (SHOWROOM only; note <= 200 words)
  --------------------------------------------------------------------------- */
  const [dmReason, setDmReason] = useState<DMReason>("Trade");
  const [dmNote, setDmNote] = useState("");

  function submitDMRequest() {
    if (wordCount(dmNote) > 200) return alert("Please keep the note within 200 words.");

    // Hard rule: only SHOWROOM users can request DM
    if (accessLevel !== "SHOWROOM") return alert("Only showroom users can request DM.");

    const hasPending = dmRequests.some((r) => r.viewerId === VIEWER_ID && r.status === "PENDING");
    if (hasPending) return alert("You already have a pending DM request.");

    const req: DMRequest = {
      id: uid(),
      viewerId: VIEWER_ID,
      reason: dmReason,
      note: dmNote.trim(),
      status: "PENDING",
      createdAt: Date.now(),
    };

    setDmRequests((prev) => [req, ...prev]);
    setDmReqOpen(false);
    setDmReason("Trade");
    setDmNote("");
    alert("DM request sent (demo). Owner can approve/decline in Inbox.");
  }

  /* ---------------------------------------------------------------------------
     SECTION 6N) Chat helpers (conversation + messages)
     IMPORTANT FIX: getOrCreateConversationId uses a functional update to avoid duplicates
  --------------------------------------------------------------------------- */

  function getOrCreateConversationId(ownerId: string, viewerId: string) {
  const id = convoIdForPair(ownerId, viewerId);

  setConversations((prev) =>
    upsertConversation(prev, {
      id,
      ownerId,
      viewerId,
      createdAt: Date.now(),
    })
  );

  return id;
}


  function openChatForPair(viewerId: string) {
    const id = getOrCreateConversationId(OWNER_ID, viewerId);
    if (!id) return;

    setActiveConversationId(id);
    setChatDraft("");
    setChatOpen(true);
  }

  function isParticipant(conversationId: string) {
    const c = conversations.find((x) => x.id === conversationId);
    if (!c) return false;
    return c.ownerId === OWNER_ID && c.viewerId === VIEWER_ID;
  }

  function sendChatMessage() {
    if (!activeConversationId) return;

    // Owner can always message. Visitor can only if canDirectDM and convo matches pair.
    if (!isOwner) {
      const canDMNow = accessLevel === "FULL" || viewerDmApproved;
      if (!canDMNow) return alert("You don’t have permission to DM.");
      if (!isParticipant(activeConversationId)) return alert("Invalid conversation.");
    }

    const body = chatDraft.trim();
    if (!body) return;

    // basic safety caps for demo
    if (body.length > 800) return alert("Message too long (max 800 characters).");

    const msg: Message = {
      id: uid(),
      conversationId: activeConversationId,
      senderId: isOwner ? OWNER_ID : VIEWER_ID,
      body,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, msg]);
    setChatDraft("");
  }

  // Auto-scroll to bottom in chat
  useEffect(() => {
    if (!chatOpen) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatOpen, activeConversationId, messages]);

  /* ---------------------------------------------------------------------------
     SECTION 6O) Inbox actions (owner)
     - Approve/decline access requests
     - Approve/decline DM requests → creates convo + sets dmApprovedByViewer[viewerId]=true
     - Manage viewer grants (upgrade/downgrade/revoke)
  --------------------------------------------------------------------------- */

  function approveAccessRequest(id: string) {
    const req = accessRequests.find((r) => r.id === id);
    if (!req) return;

    setAccessRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "APPROVED" } : r))
    );

    setGrantedAccessByViewer((prev) => ({
      ...prev,
      [req.viewerId]: req.requested,
    }));
  }

  function declineAccessRequest(id: string) {
    setAccessRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "DECLINED" } : r))
    );
  }

  function setViewerAccess(viewerId: string, level: AccessLevel) {
    if (level === "NONE") return revokeViewerAccess(viewerId);
    setGrantedAccessByViewer((prev) => ({ ...prev, [viewerId]: level }));
  }

  function revokeViewerAccess(viewerId: string) {
    setGrantedAccessByViewer((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });

    // If you revoke access, also revoke DM approval (so SHOWROOM can’t keep DM forever)
    setDmApprovedByViewer((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
  }

  function approveDMRequest(id: string) {
    const req = dmRequests.find((r) => r.id === id);
    if (!req) return;

    const convoId = getOrCreateConversationId(OWNER_ID, req.viewerId);

    setDmRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "APPROVED", conversationId: convoId ?? undefined }
          : r
      )
    );

    // This is what allows SHOWROOM → DM after approval
    setDmApprovedByViewer((prev) => ({ ...prev, [req.viewerId]: true }));

    // Optional nice UX: open chat right away for owner
    if (convoId) {
      setActiveConversationId(convoId);
      setChatOpen(true);
    }
  }

  function declineDMRequest(id: string) {
    setDmRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "DECLINED" } : r))
    );
  }

  /* ---------------------------------------------------------------------------
     SECTION 6P) Visibility rules (exact requirements)
  --------------------------------------------------------------------------- */

  const canViewCollection = accessLevel !== "NONE";
  const canRequestAccess = !isOwner && accessLevel === "NONE";

  // SHOWROOM: can request DM (note <=200). Once approved, they can DM.
  const canRequestDM = !isOwner && accessLevel === "SHOWROOM" && !viewerDmApproved;

  // FULL: can DM anytime. SHOWROOM: can DM only if approved.
  const canDirectDM = !isOwner && (accessLevel === "FULL" || viewerDmApproved);

  const showOwnerControls = isOwner;

  const modeLabel =
    privacyMode === "PRIVATE"
      ? "Private"
      : privacyMode === "SHOWROOM"
      ? "Showroom"
      : "Public";

  /* =============================================================================
     SECTION 7) UI
  ============================================================================= */

  // Messages for active conversation
  const activeMessages = useMemo(() => {
    if (!activeConversationId) return [];
    return messages
      .filter((m) => m.conversationId === activeConversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, activeConversationId]);

  return (
    <main className="min-h-screen bg-[#0b0d12] text-white">
      {/* ========================= TOP BAR ========================= */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0b0d12]/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-sm font-semibold">
                DH
              </div>
              <div>
                <div className="text-lg font-semibold">{OWNER_ID}</div>

                {isOwner || canViewCollection ? (
                  <div className="text-xs text-white/60">
                    {modeLabel} • {cars.length} cars • {totalForTrade} for trade
                    {totalForSale ? ` • ${totalForSale} for sale` : ""}
                  </div>
                ) : (
                  <div className="text-xs text-white/60">{modeLabel} • Profile locked</div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* DEMO VIEW SWITCH */}
              <div className="hidden sm:flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <button
                  className={`px-3 py-2 text-xs ${viewAs === "OWNER" ? "bg-white/10" : ""}`}
                  onClick={() => setViewAs("OWNER")}
                >
                  View as Owner
                </button>
                <button
                  className={`px-3 py-2 text-xs ${viewAs === "VISITOR" ? "bg-white/10" : ""}`}
                  onClick={() => setViewAs("VISITOR")}
                >
                  View as Visitor
                </button>
              </div>

              {showOwnerControls ? (
                <>
                  <ActionBtn onClick={openAdd}>+ Add Car</ActionBtn>

                  <ActionBtn
                    onClick={() => {
                      localStorage.removeItem(STORAGE_CARS);
                      setCars([]);
                      alert("Cleared saved cars (demo). Refresh to see seed again if you want.");
                    }}
                  >
                    Reset
                  </ActionBtn>

                  <ActionBtn onClick={() => setInboxOpen(true)}>Inbox</ActionBtn>

                  <div className="hidden sm:flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    <button
                      className={`px-3 py-2 text-xs ${privacyMode === "PRIVATE" ? "bg-white/10" : ""}`}
                      onClick={() => setPrivacyMode("PRIVATE")}
                    >
                      Private
                    </button>
                    <button
                      className={`px-3 py-2 text-xs ${privacyMode === "SHOWROOM" ? "bg-white/10" : ""}`}
                      onClick={() => setPrivacyMode("SHOWROOM")}
                    >
                      Showroom
                    </button>
                    <button
                      className={`px-3 py-2 text-xs ${privacyMode === "PUBLIC" ? "bg-white/10" : ""}`}
                      onClick={() => setPrivacyMode("PUBLIC")}
                    >
                      Public
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {canRequestAccess && (
                    <ActionBtn onClick={() => setAccessReqOpen(true)}>Request Access</ActionBtn>
                  )}

                  {canRequestDM && <ActionBtn onClick={() => setDmReqOpen(true)}>Request DM</ActionBtn>}

                  {canDirectDM && (
                    <ActionBtn onClick={() => openChatForPair(VIEWER_ID)}>DM</ActionBtn>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tabs */}
          {(isOwner || canViewCollection) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PillBtn active={tab === "showroom"} onClick={() => setTab("showroom")}>
                Showroom
              </PillBtn>
              <PillBtn active={tab === "catalog"} onClick={() => setTab("catalog")}>
                Catalog
              </PillBtn>
              <PillBtn active={tab === "trade"} onClick={() => setTab("trade")}>
                Trade & Sell
              </PillBtn>
            </div>
          )}
        </div>
      </div>

      {/* ========================= CONTENT ========================= */}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Locked view */}
        {!isOwner && accessLevel === "NONE" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="text-lg font-semibold">Private profile</div>
            <div className="mt-2 text-sm text-white/70">
              You can only see the username and avatar. Request access to view the showroom.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionBtn onClick={() => setAccessReqOpen(true)}>Request Access</ActionBtn>
              <div className="text-xs text-white/45 self-center">
                Owner can grant Showroom or Full access.
              </div>
            </div>
          </div>
        )}

        {/* Main UI */}
        {(isOwner || canViewCollection) && (
          <>
            {tab === "showroom" && (
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {cars.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCar(c)}
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left"
                  >
                    <div className="relative aspect-[4/3] bg-white/5">
  {c.media?.[0]?.kind === "image" && (
    <img
      src={getMediaSrc(c.media[0])}
      alt=""
      className="absolute inset-0 h-full w-full object-cover opacity-90"
    />
  )}
  {c.media?.[0]?.kind === "video" && (
    <video
      src={getMediaSrc(c.media[0])}
      className="absolute inset-0 h-full w-full object-cover opacity-90"
      muted
      playsInline
    />
  )}
  {!c.media?.length && (
    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-white/0" />
  )}

                      <div className="absolute left-3 top-3 flex gap-2">
                        {c.quantityOwned > 1 && <Badge>x{c.quantityOwned}</Badge>}
                        {c.quantityAvailableTrade > 0 && <Badge>Trade</Badge>}
                        {c.quantityAvailableSale > 0 && <Badge>Sale</Badge>}
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <Badge>{c.condition}</Badge>
                      </div>
                    </div>

                    <div className="p-3">
                      <div className="text-sm font-semibold leading-tight">{c.name}</div>
                      <div className="mt-1 text-xs text-white/60">
                        {c.brand}
                        {c.year ? ` • ${c.year}` : ""}
                        {c.series ? ` • ${c.series}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {tab === "catalog" && (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="text-sm font-semibold">Catalog</div>
                <div className="mt-2 text-sm text-white/70">
                  Total owned: <span className="text-white">{totalOwned}</span>
                </div>
                <div className="mt-4 text-sm text-white/60">
                  Later: filters, search, sorting, and collection types.
                </div>
              </div>
            )}

            {tab === "trade" && (
              <div className="mt-2 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold">Trade & Sell</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Trade available: <b className="text-white">{totalForTrade}</b>
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1">
                      Sale available: <b className="text-white">{totalForSale}</b>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {tradeCars.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCar(c)}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.06]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{c.name}</div>
                          <div className="mt-1 text-xs text-white/60">
                            {c.brand}
                            {c.year ? ` • ${c.year}` : ""}
                            {c.series ? ` • ${c.series}` : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {c.quantityAvailableTrade > 0 && <Badge>Trade</Badge>}
                          {c.quantityAvailableSale > 0 && <Badge>Sale</Badge>}
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-white/70">
                        Owned: {c.quantityOwned} • Trade: {c.quantityAvailableTrade} • Sale:{" "}
                        {c.quantityAvailableSale}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =============================================================================
         SECTION 8) MODALS (Access request, DM request, Inbox, Details, Add car, Chat)
      ============================================================================= */}

      {/* DETAILS MODAL */}
      {selectedCar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedCar(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d12] p-4 text-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{selectedCar.name}</div>
                <div className="mt-1 text-sm text-white/60">
                  {selectedCar.brand}
                  {selectedCar.year ? ` • ${selectedCar.year}` : ""}
                  {selectedCar.series ? ` • ${selectedCar.series}` : ""}
                </div>
              </div>
              <ActionBtn onClick={() => setSelectedCar(null)} className="text-sm">
                Close
              </ActionBtn>
            </div>
            {/* Media gallery */}
{selectedCar.media?.length ? (
  <div className="mt-4 grid grid-cols-2 gap-2">
    {selectedCar.media.map((m) => (
      <div
        key={m.id}
        className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
      >
        <div className="aspect-[4/3]">
          {m.kind === "image" ? (
            <img src={getMediaSrc(m)} alt="" className="h-full w-full object-cover" />
          ) : (
            
            <video
              src={getMediaSrc(m)}
              controls
              playsInline
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </div>
    ))}
  </div>
) : null}


            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Scale</div>
                <div className="mt-1">{show(selectedCar.scale)}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Case</div>
                <div className="mt-1">{show(selectedCar.caseCode)}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Condition</div>
                <div className="mt-1">{selectedCar.condition}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Listing</div>
                <div className="mt-1">{selectedCar.listingStatus}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Qty owned</div>
                <div className="mt-1">{selectedCar.quantityOwned}</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/60">Available</div>
                <div className="mt-1">
                  Trade: {selectedCar.quantityAvailableTrade} • Sale:{" "}
                  {selectedCar.quantityAvailableSale}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/60">Notes</div>
              <div className="mt-1 text-sm">{show(selectedCar.notes)}</div>
            </div>

            {/* Visitor quick DM entry point */}
            {!isOwner && canDirectDM && (
              <div className="mt-4 flex justify-end">
                <ActionBtn onClick={() => openChatForPair(VIEWER_ID)}>DM owner</ActionBtn>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD CAR MODAL (Owner) */}
      {addOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Add a car</div>
                <div className="text-sm text-white/60">Clean details. Maximum pride.</div>
              </div>
              <ActionBtn onClick={() => setAddOpen(false)}>Close</ActionBtn>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/70">Car name *</div>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Brand *</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Scale</div>
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.scale}
                    onChange={(e) => setForm({ ...form, scale: e.target.value })}
                  >
                    <option value="">Select scale</option>
                    <option value="1:64">1:64</option>
                    <option value="1:43">1:43</option>
                    <option value="1:24">1:24</option>
                    <option value="1:18">1:18</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Year</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Case</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.caseCode}
                    onChange={(e) => setForm({ ...form, caseCode: e.target.value })}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Series</div>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.series}
                    onChange={(e) => setForm({ ...form, series: e.target.value })}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Qty owned</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.quantityOwned}
                    onChange={(e) => setForm({ ...form, quantityOwned: clampInt(e.target.value) })}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Avail. trade</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.quantityAvailableTrade}
                    onChange={(e) => setForm({ ...form, quantityAvailableTrade: clampInt(e.target.value) })}
                  />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/70">Avail. sale</div>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                    value={form.quantityAvailableSale}
                    onChange={(e) => setForm({ ...form, quantityAvailableSale: clampInt(e.target.value) })}
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-1 text-xs text-white/70">Condition</div>
                <select
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value as Condition })}
                >
                  <option value="Carded">Carded</option>
                  <option value="Loose">Loose</option>
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs text-white/70">Notes</div>
                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
  <div className="text-sm font-semibold">Media</div>
  <div className="mt-1 text-xs text-white/60">
  Add up to {MAX_MEDIA_ITEMS}. Demo limit: ~0.9MB per file.
</div>


  <div className="mt-3 flex flex-wrap items-center gap-2">
    <input
      type="file"
      accept="image/*,video/*"
      multiple
      disabled={uploading}
      onChange={(e) => addMediaFiles(e.target.files)}
      className="text-xs"
    />
  </div>

  {form.media.length > 0 && (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {form.media.map((m) => (
        <div
          key={m.id}
          className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5"
        >
          <div className="aspect-[4/3]">
  {m.kind === "image" ? (
    <img src={getMediaSrc(m)} alt="" className="h-full w-full object-cover" />
  ) : (
    <video
      src={getMediaSrc(m)}
      className="h-full w-full object-cover"
      muted
      playsInline
    />
  )}
</div>

          <button
            type="button"
            onClick={() => removeMedia(m.id)}
            className="absolute right-2 top-2 rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-[11px]"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )}
</div>


              <div className="mt-2 flex items-center justify-end gap-2">
                <ActionBtn onClick={() => setAddOpen(false)}>Cancel</ActionBtn>
                <button
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
                  onClick={saveNewCar}
                  disabled={uploading}
                >
                  {uploading ? "Uploading..." : "Save car"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACCESS REQUEST MODAL (Visitor) */}
      {accessReqOpen && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAccessReqOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Request access</div>
                <div className="mt-1 text-sm text-white/60">Choose access + note (max 100 words).</div>
              </div>
              <ActionBtn onClick={() => setAccessReqOpen(false)} className="text-sm">
                Close
              </ActionBtn>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/70">Requested access</div>
                <select
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={accessReqLevel}
                  onChange={(e) => setAccessReqLevel(e.target.value as "SHOWROOM" | "FULL")}
                >
                  <option value="SHOWROOM">Showroom access</option>
                  <option value="FULL">Full access</option>
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs text-white/70">
                  Note (max 100 words) • {wordCount(accessReqNote)}/100
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={accessReqNote}
                  onChange={(e) => setAccessReqNote(e.target.value)}
                  placeholder="A short note on why you want access…"
                />
              </label>

              <div className="mt-2 flex items-center justify-end gap-2">
                <ActionBtn onClick={() => setAccessReqOpen(false)}>Cancel</ActionBtn>
                <button
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
                  disabled={wordCount(accessReqNote) > 100}
                  onClick={submitAccessRequest}
                >
                  Send request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DM REQUEST MODAL (Showroom only) */}
      {dmReqOpen && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDmReqOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Request DM</div>
                <div className="mt-1 text-sm text-white/60">Explain what you want to talk about (max 200 words).</div>
              </div>
              <ActionBtn onClick={() => setDmReqOpen(false)} className="text-sm">
                Close
              </ActionBtn>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/70">Reason</div>
                <select
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={dmReason}
                  onChange={(e) => setDmReason(e.target.value as DMReason)}
                >
                  <option value="Trade">Trade</option>
                  <option value="Buy">Buy</option>
                  <option value="Sell">Sell</option>
                  <option value="Question">Question</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs text-white/70">
                  Note (max 200 words) • {wordCount(dmNote)}/200
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                  value={dmNote}
                  onChange={(e) => setDmNote(e.target.value)}
                  placeholder="What do you want to talk about?"
                />
              </label>

              <div className="mt-2 flex items-center justify-end gap-2">
                <ActionBtn onClick={() => setDmReqOpen(false)}>Cancel</ActionBtn>
                <button
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
                  disabled={wordCount(dmNote) > 200}
                  onClick={submitDMRequest}
                >
                  Send request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INBOX (Owner) */}
      {inboxOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setInboxOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Inbox</div>
                <div className="mt-1 text-sm text-white/60">Approve/decline access + DM requests.</div>
              </div>
              <ActionBtn onClick={() => setInboxOpen(false)} className="text-sm">
                Close
              </ActionBtn>
            </div>

            <div className="mt-4 grid gap-6">
              {/* Access requests */}
              <div>
                <div className="text-sm font-semibold">Access requests</div>
                <div className="mt-2 grid gap-2">
                  {accessRequests.length === 0 && (
                    <div className="text-sm text-white/60">No access requests.</div>
                  )}

                  {accessRequests.map((r) => (
                    <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm">
                            Viewer: <b>{r.viewerId}</b> • Request: <b>{r.requested}</b> •{" "}
                            <span className="text-white/60">{new Date(r.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="mt-1 text-sm text-white/70">Note: {r.note?.trim() ? r.note : "—"}</div>
                          <div className="mt-1 text-xs text-white/50">Status: {r.status}</div>
                        </div>

                        {r.status === "PENDING" && (
                          <div className="flex gap-2">
                            <ActionBtn onClick={() => approveAccessRequest(r.id)}>Approve</ActionBtn>
                            <ActionBtn onClick={() => declineAccessRequest(r.id)} className="bg-white/0">
                              Decline
                            </ActionBtn>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* DM requests */}
              <div>
                <div className="text-sm font-semibold">DM requests</div>
                <div className="mt-2 grid gap-2">
                  {dmRequests.length === 0 && <div className="text-sm text-white/60">No DM requests.</div>}

                  {dmRequests.map((r) => (
                    <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm">
                            Viewer: <b>{r.viewerId}</b> • Reason: <b>{r.reason}</b> •{" "}
                            <span className="text-white/60">{new Date(r.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="mt-1 text-sm text-white/70">Note: {r.note?.trim() ? r.note : "—"}</div>
                          <div className="mt-1 text-xs text-white/50">Status: {r.status}</div>
                        </div>

                        {r.status === "PENDING" && (
                          <div className="flex gap-2">
                            <ActionBtn onClick={() => approveDMRequest(r.id)}>Approve</ActionBtn>
                            <ActionBtn onClick={() => declineDMRequest(r.id)} className="bg-white/0">
                              Decline
                            </ActionBtn>
                          </div>
                        )}

                        {r.status === "APPROVED" && (
                          <div className="flex gap-2">
                            <ActionBtn onClick={() => openChatForPair(r.viewerId)}>Open chat</ActionBtn>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Access control */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-sm font-semibold">Access control</div>
                <div className="mt-1 text-xs text-white/60">Upgrade, downgrade, or revoke per viewer.</div>

                <div className="mt-3 grid gap-2">
                  {Object.keys(grantedAccessByViewer).length === 0 && (
                    <div className="text-sm text-white/60">No viewers have access yet.</div>
                  )}

                  {Object.entries(grantedAccessByViewer).map(([viewerId, level]) => (
                    <div key={viewerId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-sm">
                        Viewer: <b>{viewerId}</b> • Access: <b>{level}</b>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionBtn onClick={() => setViewerAccess(viewerId, "SHOWROOM")}>Set Showroom</ActionBtn>
                        <ActionBtn onClick={() => setViewerAccess(viewerId, "FULL")}>Set Full</ActionBtn>
                        <ActionBtn onClick={() => revokeViewerAccess(viewerId)} className="bg-white/0">
                          Revoke
                        </ActionBtn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Debug snapshot */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm">
                <div className="text-white/70">
                  Mode: <b>{privacyMode}</b> • Viewer: <b>{VIEWER_ID}</b> • Grant: <b>{viewerGrant}</b> • DM approved:{" "}
                  <b>{viewerDmApproved ? "Yes" : "No"}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHAT MODAL */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setChatOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0d12] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Direct messages</div>
                <div className="mt-1 text-sm text-white/60">
                  {isOwner ? `Chat with ${VIEWER_ID}` : `Chat with ${OWNER_ID}`}
                </div>
              </div>
              <ActionBtn onClick={() => setChatOpen(false)} className="text-sm">
                Close
              </ActionBtn>
            </div>

            <div className="mt-4 h-[360px] overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              {activeMessages.length === 0 ? (
                <div className="text-sm text-white/60">No messages yet. Say hi.</div>
              ) : (
                <div className="grid gap-2">
                  {activeMessages.map((m) => {
                    const mine = m.senderId === (isOwner ? OWNER_ID : VIEWER_ID);
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className="max-w-[80%] rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                          <div className="text-xs text-white/50">
                            {m.senderId} • {new Date(m.createdAt).toLocaleString()}
                          </div>
                          <div className="mt-1 text-sm whitespace-pre-wrap break-words">{m.body}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            <div className="mt-3 flex items-end gap-2">
              <textarea
                className="min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="Type a message… (max 800 chars)"
              />
              <button
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
                disabled={!chatDraft.trim()}
                onClick={sendChatMessage}
              >
                Send
              </button>
            </div>

            {!isOwner && !canDirectDM && (
              <div className="mt-2 text-xs text-red-300">
                You don’t currently have permission to DM.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
