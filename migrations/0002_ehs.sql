-- Wolcen EHS application schema

create table if not exists profiles (
  user_id     text primary key,
  full_name   text not null default '',
  role        text not null default 'Employee',
  department  text not null default 'Operations',
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id          serial primary key,
  user_id     text not null,
  name        text not null,
  budget      numeric not null default 0,
  deadline    date,
  status      text not null default 'Planning',
  created_at  timestamptz not null default now()
);
create index if not exists projects_user_id_idx on projects (user_id);

create table if not exists project_tasks (
  id          serial primary key,
  user_id     text not null,
  project_id  integer,
  title       text not null,
  assignee    text,
  priority    text not null default 'Normal',
  status      text not null default 'Pending',
  created_at  timestamptz not null default now()
);
create index if not exists project_tasks_user_id_idx on project_tasks (user_id);

create table if not exists incidents (
  id          serial primary key,
  user_id     text not null,
  title       text not null,
  location    text not null default '',
  severity    text not null default 'Low',
  status      text not null default 'Reported',
  created_at  timestamptz not null default now()
);
create index if not exists incidents_user_id_idx on incidents (user_id);

create table if not exists health_declarations (
  id          serial primary key,
  user_id     text not null,
  fitness     text not null default 'Fit for Duty',
  temperature numeric,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists health_declarations_user_id_idx on health_declarations (user_id);

create table if not exists notifications (
  id            serial primary key,
  user_id       text not null,
  title         text not null,
  message       text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user_id_idx on notifications (user_id, created_at desc);
