import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://uooqynhqjeusryuwghhe.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3F5bmhxamV1c3J5dXdnaGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MDUwMTMsImV4cCI6MjA5MTI4MTAxM30.t4kKDQGY-YNSPJxYLu1fgeGFSrIiEc2nHlgksiCTbSE'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)