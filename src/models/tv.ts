export interface Channel {
  id: string
  name: string
  icon?: string
  number?: number
}
export interface ProgrammePerson {
  name: string
  role?: string
}
export interface ProgrammeCredits {
  directors?: string[]
  actors?: ProgrammePerson[]
  presenters?: string[]
  writers?: string[]
  producers?: string[]
  composers?: string[]
  editors?: string[]
  adapters?: string[]
  commentators?: string[]
  guests?: string[]
}
export interface TVProgramme {
  id: string
  channelId: string
  start: string
  end: string
  title: string
  subtitle?: string
  description?: string
  category?: string
  categories?: string[]
  durationMinutes?: number
  xmltvLengthMinutes?: number
  season?: number
  episode?: number
  imageUrl?: string
  isNew?: boolean
  isLive?: boolean
  credits?: ProgrammeCredits
  year?: string
  countries?: string[]
  rating?: string
  ratingSystem?: string
  starRating?: string
}
export type ProgrammeKind = 'movie' | 'tv_movie' | 'tv_series'
export interface EpgData {
  channels: Channel[]
  programmes: TVProgramme[]
  fetchedAt: string
  source: string
  etag?: string
  lastModified?: string
  periodStart?: string
  periodEnd?: string
}
export type GuideMode = 'now' | 'prime'
