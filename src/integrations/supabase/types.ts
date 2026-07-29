export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      branches: {
        Row: {
          branch_name: string
          city: string | null
          client_id: string | null
          created_at: string | null
          id: string
        }
        Insert: {
          branch_name: string
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Update: {
          branch_name?: string
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_hold: boolean | null
          business_type: string | null
          city: string | null
          client_code: string | null
          client_type: string | null
          created_at: string | null
          date_added: string | null
          dba: string | null
          email: string | null
          id: string
          last_order_date: string | null
          legal_name: string
          notes: string | null
          phone: string | null
          primary_contact: string | null
          reminders_paused: boolean | null
          reorder_alert_sent: boolean | null
          reorder_threshold_days: number | null
          sales_rep: string | null
          status: string | null
        }
        Insert: {
          account_hold?: boolean | null
          business_type?: string | null
          city?: string | null
          client_code?: string | null
          client_type?: string | null
          created_at?: string | null
          date_added?: string | null
          dba?: string | null
          email?: string | null
          id?: string
          last_order_date?: string | null
          legal_name: string
          notes?: string | null
          phone?: string | null
          primary_contact?: string | null
          reminders_paused?: boolean | null
          reorder_alert_sent?: boolean | null
          reorder_threshold_days?: number | null
          sales_rep?: string | null
          status?: string | null
        }
        Update: {
          account_hold?: boolean | null
          business_type?: string | null
          city?: string | null
          client_code?: string | null
          client_type?: string | null
          created_at?: string | null
          date_added?: string | null
          dba?: string | null
          email?: string | null
          id?: string
          last_order_date?: string | null
          legal_name?: string
          notes?: string | null
          phone?: string | null
          primary_contact?: string | null
          reminders_paused?: boolean | null
          reorder_alert_sent?: boolean | null
          reorder_threshold_days?: number | null
          sales_rep?: string | null
          status?: string | null
        }
        Relationships: []
      }
      daily_production: {
        Row: {
          actual_packs_produced: number | null
          ai_flag: string | null
          created_at: string | null
          date: string
          day_end_sent: boolean | null
          id: string
          notes: string | null
          pack_size_kg: number
          packs_produced: number | null
          raw_input_kg: number
          target_packs: number | null
          usable_kg: number | null
          variance_packs: number | null
          variance_reason: string | null
          wastage_percent: number
        }
        Insert: {
          actual_packs_produced?: number | null
          ai_flag?: string | null
          created_at?: string | null
          date?: string
          day_end_sent?: boolean | null
          id?: string
          notes?: string | null
          pack_size_kg?: number
          packs_produced?: number | null
          raw_input_kg: number
          target_packs?: number | null
          usable_kg?: number | null
          variance_packs?: number | null
          variance_reason?: string | null
          wastage_percent?: number
        }
        Update: {
          actual_packs_produced?: number | null
          ai_flag?: string | null
          created_at?: string | null
          date?: string
          day_end_sent?: boolean | null
          id?: string
          notes?: string | null
          pack_size_kg?: number
          packs_produced?: number | null
          raw_input_kg?: number
          target_packs?: number | null
          usable_kg?: number | null
          variance_packs?: number | null
          variance_reason?: string | null
          wastage_percent?: number
        }
        Relationships: []
      }
      damaged_stock: {
        Row: {
          batch_no: string | null
          category: string
          created_at: string
          entry_no: string
          id: string
          item_description: string
          loss_date: string
          notes: string | null
          qty_lost: number
          total_loss_value: number
          unit_cost: number
          updated_at: string
        }
        Insert: {
          batch_no?: string | null
          category?: string
          created_at?: string
          entry_no?: string
          id?: string
          item_description: string
          loss_date?: string
          notes?: string | null
          qty_lost?: number
          total_loss_value?: number
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          batch_no?: string | null
          category?: string
          created_at?: string
          entry_no?: string
          id?: string
          item_description?: string
          loss_date?: string
          notes?: string | null
          qty_lost?: number
          total_loss_value?: number
          unit_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      delivery_areas: {
        Row: {
          area_name: string
          created_at: string | null
          distance_km: number
          id: string
        }
        Insert: {
          area_name: string
          created_at?: string | null
          distance_km: number
          id?: string
        }
        Update: {
          area_name?: string
          created_at?: string | null
          distance_km?: number
          id?: string
        }
        Relationships: []
      }
      delivery_calculations: {
        Row: {
          calculated_fuel_cost: number | null
          client_id: string | null
          created_at: string | null
          delivery_area: string | null
          distance_km: number | null
          fuel_efficiency: number | null
          id: string
          invoice_id: string | null
          notes: string | null
          petrol_rate: number | null
          service_fee: number | null
          total_delivery_cost: number | null
          vehicle_type: string | null
        }
        Insert: {
          calculated_fuel_cost?: number | null
          client_id?: string | null
          created_at?: string | null
          delivery_area?: string | null
          distance_km?: number | null
          fuel_efficiency?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          petrol_rate?: number | null
          service_fee?: number | null
          total_delivery_cost?: number | null
          vehicle_type?: string | null
        }
        Update: {
          calculated_fuel_cost?: number | null
          client_id?: string | null
          created_at?: string | null
          delivery_area?: string | null
          distance_km?: number | null
          fuel_efficiency?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          petrol_rate?: number | null
          service_fee?: number | null
          total_delivery_cost?: number | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_calculations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_calculations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_salaries: {
        Row: {
          absent_days: number
          advance_balance: number
          advance_repaid: number | null
          advance_taken: number
          basic_salary: number
          created_at: string
          department: string | null
          designation: string | null
          employee_id: string
          employee_name: string
          gross_salary: number
          id: string
          income_tax: number
          month: string
          non_paid_holidays: number
          repayment_collected_by: string | null
          total_working_days: number
          updated_at: string
        }
        Insert: {
          absent_days?: number
          advance_balance?: number
          advance_repaid?: number | null
          advance_taken?: number
          basic_salary?: number
          created_at?: string
          department?: string | null
          designation?: string | null
          employee_id: string
          employee_name: string
          gross_salary?: number
          id?: string
          income_tax?: number
          month: string
          non_paid_holidays?: number
          repayment_collected_by?: string | null
          total_working_days?: number
          updated_at?: string
        }
        Update: {
          absent_days?: number
          advance_balance?: number
          advance_repaid?: number | null
          advance_taken?: number
          basic_salary?: number
          created_at?: string
          department?: string | null
          designation?: string | null
          employee_id?: string
          employee_name?: string
          gross_salary?: number
          id?: string
          income_tax?: number
          month?: string
          non_paid_holidays?: number
          repayment_collected_by?: string | null
          total_working_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          added_by: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          date: string
          id: string
          item: string
          price: number
          subcategory: string | null
        }
        Insert: {
          added_by?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          date: string
          id?: string
          item: string
          price: number
          subcategory?: string | null
        }
        Update: {
          added_by?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          item?: string
          price?: number
          subcategory?: string | null
        }
        Relationships: []
      }
      inventory: {
        Row: {
          cost_per_unit: number | null
          created_at: string | null
          current_stock: number | null
          id: string
          item_name: string
          minimum_stock: number | null
          unit: string | null
        }
        Insert: {
          cost_per_unit?: number | null
          created_at?: string | null
          current_stock?: number | null
          id?: string
          item_name: string
          minimum_stock?: number | null
          unit?: string | null
        }
        Update: {
          cost_per_unit?: number | null
          created_at?: string | null
          current_stock?: number | null
          id?: string
          item_name?: string
          minimum_stock?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      inventory_stock: {
        Row: {
          closing_packs: number | null
          created_at: string | null
          date: string
          id: string
          notes: string | null
          opening_packs: number | null
          packs_delivered: number | null
          packs_produced: number | null
          raw_material_kg: number | null
        }
        Insert: {
          closing_packs?: number | null
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          opening_packs?: number | null
          packs_delivered?: number | null
          packs_produced?: number | null
          raw_material_kg?: number | null
        }
        Update: {
          closing_packs?: number | null
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          opening_packs?: number | null
          packs_delivered?: number | null
          packs_produced?: number | null
          raw_material_kg?: number | null
        }
        Relationships: []
      }
      investor_returns: {
        Row: {
          created_at: string
          id: string
          investor_id: string
          month: string
          net_profit: number
          notes: string | null
          paid: boolean
          paid_date: string | null
          return_amount: number
          return_percentage: number
        }
        Insert: {
          created_at?: string
          id?: string
          investor_id: string
          month: string
          net_profit?: number
          notes?: string | null
          paid?: boolean
          paid_date?: string | null
          return_amount?: number
          return_percentage?: number
        }
        Update: {
          created_at?: string
          id?: string
          investor_id?: string
          month?: string
          net_profit?: number
          notes?: string | null
          paid?: boolean
          paid_date?: string | null
          return_amount?: number
          return_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "investor_returns_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      investors: {
        Row: {
          created_at: string
          duration_years: number
          email: string
          id: string
          investment_amount: number
          investment_date: string
          investment_end_date: string
          name: string
          notes: string | null
          phone: string | null
          roi_percentage: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_years: number
          email: string
          id?: string
          investment_amount: number
          investment_date: string
          investment_end_date: string
          name: string
          notes?: string | null
          phone?: string | null
          roi_percentage: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_years?: number
          email?: string
          id?: string
          investment_amount?: number
          investment_date?: string
          investment_end_date?: string
          name?: string
          notes?: string | null
          phone?: string | null
          roi_percentage?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number | null
          amount_received: number | null
          branch_id: string | null
          client_id: string | null
          created_at: string | null
          date: string
          deleted_at: string | null
          delivered: boolean | null
          delivery_date: string | null
          due_date: string | null
          escalated: boolean | null
          final_notice: boolean | null
          id: string
          invoice_no: string | null
          is_deleted: boolean | null
          item: string | null
          last_reminder_sent: string | null
          last_reminder_type: string | null
          no_of_packs: number | null
          payment_status:
            | Database["public"]["Enums"]["payment_status_enum"]
            | null
          reminder_sent: boolean | null
          reminder_sent_at: string | null
          screenshot_verified: boolean | null
          total_reminders_sent: number | null
          transaction_id: string | null
          unit_price: number | null
          weight_kg: number | null
        }
        Insert: {
          amount?: number | null
          amount_received?: number | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string | null
          date: string
          deleted_at?: string | null
          delivered?: boolean | null
          delivery_date?: string | null
          due_date?: string | null
          escalated?: boolean | null
          final_notice?: boolean | null
          id?: string
          invoice_no?: string | null
          is_deleted?: boolean | null
          item?: string | null
          last_reminder_sent?: string | null
          last_reminder_type?: string | null
          no_of_packs?: number | null
          payment_status?:
            | Database["public"]["Enums"]["payment_status_enum"]
            | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          screenshot_verified?: boolean | null
          total_reminders_sent?: number | null
          transaction_id?: string | null
          unit_price?: number | null
          weight_kg?: number | null
        }
        Update: {
          amount?: number | null
          amount_received?: number | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string | null
          date?: string
          deleted_at?: string | null
          delivered?: boolean | null
          delivery_date?: string | null
          due_date?: string | null
          escalated?: boolean | null
          final_notice?: boolean | null
          id?: string
          invoice_no?: string | null
          is_deleted?: boolean | null
          item?: string | null
          last_reminder_sent?: string | null
          last_reminder_type?: string | null
          no_of_packs?: number | null
          payment_status?:
            | Database["public"]["Enums"]["payment_status_enum"]
            | null
          reminder_sent?: boolean | null
          reminder_sent_at?: string | null
          screenshot_verified?: boolean | null
          total_reminders_sent?: number | null
          transaction_id?: string | null
          unit_price?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_screenshots: {
        Row: {
          client_id: string | null
          created_at: string | null
          extracted_amount: number | null
          extracted_date: string | null
          extracted_transaction_id: string | null
          id: string
          image_url: string | null
          invoice_id: string | null
          match_confidence: string | null
          match_notes: string | null
          match_status: string | null
          matched_invoice_no: string | null
          raw_vision_response: string | null
          uploaded_by: string | null
          verified: boolean | null
          verified_by: string | null
          whatsapp_from: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_transaction_id?: string | null
          id?: string
          image_url?: string | null
          invoice_id?: string | null
          match_confidence?: string | null
          match_notes?: string | null
          match_status?: string | null
          matched_invoice_no?: string | null
          raw_vision_response?: string | null
          uploaded_by?: string | null
          verified?: boolean | null
          verified_by?: string | null
          whatsapp_from?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_transaction_id?: string | null
          id?: string
          image_url?: string | null
          invoice_id?: string | null
          match_confidence?: string | null
          match_notes?: string | null
          match_status?: string | null
          matched_invoice_no?: string | null
          raw_vision_response?: string | null
          uploaded_by?: string | null
          verified?: boolean | null
          verified_by?: string | null
          whatsapp_from?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_screenshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_screenshots_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      reorder_alerts: {
        Row: {
          alert_sent: boolean | null
          alert_sent_at: string | null
          branch_id: string | null
          client_id: string | null
          created_at: string | null
          days_since_order: number | null
          id: string
          last_order_date: string | null
          resolved: boolean | null
          resolved_at: string | null
        }
        Insert: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string | null
          days_since_order?: number | null
          id?: string
          last_order_date?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
        }
        Update: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          branch_id?: string | null
          client_id?: string | null
          created_at?: string | null
          days_since_order?: number | null
          id?: string
          last_order_date?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reorder_alerts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          branch: string | null
          client_name: string | null
          created_at: string
          id: string
          invoice_id: string | null
          item_description: string
          notes: string | null
          reason: string | null
          return_date: string
          return_no: string
          return_qty: number
          status: string
          total_return_value: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          branch?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          item_description: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_no?: string
          return_qty?: number
          status?: string
          total_return_value?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          branch?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          item_description?: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_no?: string
          return_qty?: number
          status?: string
          total_return_value?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          auto_reminders_enabled: boolean | null
          auto_verify_high_confidence: boolean | null
          bank_details: string | null
          created_at: string | null
          daily_report_enabled: boolean | null
          day_end_last_sent_at: string | null
          day_end_notification_enabled: boolean | null
          day_end_report_time: string | null
          default_vehicle_type: string | null
          id: string
          meta_access_token: string | null
          meta_phone_number_id: string | null
          meta_verify_token: string | null
          petrol_rate_per_litre: number | null
          reorder_threshold_days: number | null
          resend_api_key: string | null
          sales_rep_name: string | null
          sales_rep_phone: string | null
          send_client_confirmation: boolean | null
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_whatsapp_number: string | null
          whatsapp_group_number: string | null
          whatsapp_report_number: string | null
        }
        Insert: {
          auto_reminders_enabled?: boolean | null
          auto_verify_high_confidence?: boolean | null
          bank_details?: string | null
          created_at?: string | null
          daily_report_enabled?: boolean | null
          day_end_last_sent_at?: string | null
          day_end_notification_enabled?: boolean | null
          day_end_report_time?: string | null
          default_vehicle_type?: string | null
          id?: string
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          petrol_rate_per_litre?: number | null
          reorder_threshold_days?: number | null
          resend_api_key?: string | null
          sales_rep_name?: string | null
          sales_rep_phone?: string | null
          send_client_confirmation?: boolean | null
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_whatsapp_number?: string | null
          whatsapp_group_number?: string | null
          whatsapp_report_number?: string | null
        }
        Update: {
          auto_reminders_enabled?: boolean | null
          auto_verify_high_confidence?: boolean | null
          bank_details?: string | null
          created_at?: string | null
          daily_report_enabled?: boolean | null
          day_end_last_sent_at?: string | null
          day_end_notification_enabled?: boolean | null
          day_end_report_time?: string | null
          default_vehicle_type?: string | null
          id?: string
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          petrol_rate_per_litre?: number | null
          reorder_threshold_days?: number | null
          resend_api_key?: string | null
          sales_rep_name?: string | null
          sales_rep_phone?: string | null
          send_client_confirmation?: boolean | null
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_whatsapp_number?: string | null
          whatsapp_group_number?: string | null
          whatsapp_report_number?: string | null
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string | null
          id: string
          inventory_id: string | null
          invoice_id: string | null
          movement_date: string | null
          movement_type: string | null
          notes: string | null
          quantity: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inventory_id?: string | null
          invoice_id?: string | null
          movement_date?: string | null
          movement_type?: string | null
          notes?: string | null
          quantity?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inventory_id?: string | null
          invoice_id?: string | null
          movement_date?: string | null
          movement_type?: string | null
          notes?: string | null
          quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_logs: {
        Row: {
          channel: string | null
          client_id: string | null
          id: string
          invoice_id: string | null
          message: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          channel?: string | null
          client_id?: string | null
          id?: string
          invoice_id?: string | null
          message?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          channel?: string | null
          client_id?: string | null
          id?: string
          invoice_id?: string | null
          message?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "investor" | "staff" | "viewer"
      payment_status_enum: "Done" | "Not Done" | "Partial" | "Unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "investor", "staff", "viewer"],
      payment_status_enum: ["Done", "Not Done", "Partial", "Unknown"],
    },
  },
} as const
