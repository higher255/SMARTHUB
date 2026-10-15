-- Let every employee file either a leave request or a short permission request.
alter table leave_requests
  drop constraint if exists leave_requests_leave_type_check;

alter table leave_requests
  add constraint leave_requests_leave_type_check
  check (leave_type in ('Annual', 'Sick', 'Compassionate', 'Unpaid', 'Other', 'Permission'));
