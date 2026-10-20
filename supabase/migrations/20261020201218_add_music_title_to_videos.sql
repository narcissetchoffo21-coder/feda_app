alter table public.videos
  add column if not exists music_title text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'videos_music_title_length'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos
      add constraint videos_music_title_length
      check (char_length(music_title) <= 120);
  end if;
end
$$;

comment on column public.videos.music_title is
  'Optional display title for the music or original sound used in the video.';
