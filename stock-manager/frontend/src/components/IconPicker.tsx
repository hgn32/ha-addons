import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import SearchIcon from "@mui/icons-material/Search";
import HomeIcon from "@mui/icons-material/Home";
import KitchenIcon from "@mui/icons-material/Kitchen";
import BedroomParentIcon from "@mui/icons-material/BedroomParent";
import WeekendIcon from "@mui/icons-material/Weekend";
import BathroomIcon from "@mui/icons-material/Bathroom";
import LocalLaundryServiceIcon from "@mui/icons-material/LocalLaundryService";
import GarageIcon from "@mui/icons-material/Garage";
import YardIcon from "@mui/icons-material/Yard";
import StorageIcon from "@mui/icons-material/Storage";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import CategoryIcon from "@mui/icons-material/Category";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBag";
import StoreIcon from "@mui/icons-material/Store";
import StorefrontIcon from "@mui/icons-material/Storefront";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import LocalPizzaIcon from "@mui/icons-material/LocalPizza";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import FastfoodIcon from "@mui/icons-material/Fastfood";
import LocalBarIcon from "@mui/icons-material/LocalBar";
import IcecreamIcon from "@mui/icons-material/Icecream";
import BuildIcon from "@mui/icons-material/Build";
import HandymanIcon from "@mui/icons-material/Handyman";
import HardwareIcon from "@mui/icons-material/Hardware";
import PlumbingIcon from "@mui/icons-material/Plumbing";
import ElectricalServicesIcon from "@mui/icons-material/ElectricalServices";
import ConstructionIcon from "@mui/icons-material/Construction";
import DevicesIcon from "@mui/icons-material/Devices";
import ComputerIcon from "@mui/icons-material/Computer";
import PhoneAndroidIcon from "@mui/icons-material/PhoneAndroid";
import TvIcon from "@mui/icons-material/Tv";
import SportsBaseballIcon from "@mui/icons-material/SportsBaseball";
import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import CommuteIcon from "@mui/icons-material/Commute";
import FlightIcon from "@mui/icons-material/Flight";
import WorkIcon from "@mui/icons-material/Work";
import BusinessIcon from "@mui/icons-material/Business";
import PrintIcon from "@mui/icons-material/Print";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import MedicationIcon from "@mui/icons-material/Medication";
import VaccinesIcon from "@mui/icons-material/Vaccines";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import CheckroomIcon from "@mui/icons-material/Checkroom";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import PetsIcon from "@mui/icons-material/Pets";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import SchoolIcon from "@mui/icons-material/School";
import CelebrationIcon from "@mui/icons-material/Celebration";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import FavoriteIcon from "@mui/icons-material/Favorite";
import StarIcon from "@mui/icons-material/Star";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import { useState } from "react";

interface IconEntry {
  name: string;
  Component: React.ComponentType<SvgIconProps>;
}

export const ICONS: IconEntry[] = [
  { name: "Home", Component: HomeIcon },
  { name: "Kitchen", Component: KitchenIcon },
  { name: "Bedroom", Component: BedroomParentIcon },
  { name: "Weekend", Component: WeekendIcon },
  { name: "Bathroom", Component: BathroomIcon },
  { name: "LocalLaundryService", Component: LocalLaundryServiceIcon },
  { name: "Garage", Component: GarageIcon },
  { name: "Yard", Component: YardIcon },
  { name: "Storage", Component: StorageIcon },
  { name: "Inventory2", Component: Inventory2Icon },
  { name: "Category", Component: CategoryIcon },
  { name: "ShoppingCart", Component: ShoppingCartIcon },
  { name: "ShoppingBag", Component: ShoppingBagIcon },
  { name: "Store", Component: StoreIcon },
  { name: "Storefront", Component: StorefrontIcon },
  { name: "Restaurant", Component: RestaurantIcon },
  { name: "LocalPizza", Component: LocalPizzaIcon },
  { name: "LocalCafe", Component: LocalCafeIcon },
  { name: "Fastfood", Component: FastfoodIcon },
  { name: "LocalBar", Component: LocalBarIcon },
  { name: "Icecream", Component: IcecreamIcon },
  { name: "Build", Component: BuildIcon },
  { name: "Handyman", Component: HandymanIcon },
  { name: "Hardware", Component: HardwareIcon },
  { name: "Plumbing", Component: PlumbingIcon },
  { name: "ElectricalServices", Component: ElectricalServicesIcon },
  { name: "Construction", Component: ConstructionIcon },
  { name: "Devices", Component: DevicesIcon },
  { name: "Computer", Component: ComputerIcon },
  { name: "PhoneAndroid", Component: PhoneAndroidIcon },
  { name: "Tv", Component: TvIcon },
  { name: "SportsBaseball", Component: SportsBaseballIcon },
  { name: "FitnessCenter", Component: FitnessCenterIcon },
  { name: "DirectionsCar", Component: DirectionsCarIcon },
  { name: "Commute", Component: CommuteIcon },
  { name: "Flight", Component: FlightIcon },
  { name: "Work", Component: WorkIcon },
  { name: "Business", Component: BusinessIcon },
  { name: "Print", Component: PrintIcon },
  { name: "MedicalServices", Component: MedicalServicesIcon },
  { name: "Medication", Component: MedicationIcon },
  { name: "Vaccines", Component: VaccinesIcon },
  { name: "HealthAndSafety", Component: HealthAndSafetyIcon },
  { name: "CleaningServices", Component: CleaningServicesIcon },
  { name: "Checkroom", Component: CheckroomIcon },
  { name: "LocalPharmacy", Component: LocalPharmacyIcon },
  { name: "Pets", Component: PetsIcon },
  { name: "ChildCare", Component: ChildCareIcon },
  { name: "School", Component: SchoolIcon },
  { name: "Celebration", Component: CelebrationIcon },
  { name: "CardGiftcard", Component: CardGiftcardIcon },
  { name: "Favorite", Component: FavoriteIcon },
  { name: "Star", Component: StarIcon },
  { name: "Bookmark", Component: BookmarkIcon },
];

export function DynamicIcon({ name, ...props }: { name: string } & SvgIconProps) {
  const entry = ICONS.find((i) => i.name === name);
  if (!entry) return <CategoryIcon {...props} />;
  return <entry.Component {...props} />;
}

interface Props {
  value: string;
  onChange: (iconName: string) => void;
}

export default function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = ICONS.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch("");
  };

  const CurrentIcon = value ? ICONS.find((i) => i.name === value)?.Component : null;

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={() => setOpen(true)}
        startIcon={CurrentIcon ? <CurrentIcon /> : <CategoryIcon />}
      >
        {value || "アイコンを選択"}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>アイコンを選択</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            placeholder="検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 0.5,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {filtered.map(({ name, Component }) => (
              <Tooltip key={name} title={name}>
                <IconButton
                  onClick={() => handleSelect(name)}
                  sx={{
                    borderRadius: 1,
                    border: value === name ? "2px solid" : "2px solid transparent",
                    borderColor: value === name ? "primary.main" : "transparent",
                    bgcolor: value === name ? "primary.50" : undefined,
                  }}
                >
                  <Component />
                </IconButton>
              </Tooltip>
            ))}
            {filtered.length === 0 && (
              <Stack sx={{ gridColumn: "span 6", alignItems: "center", py: 4 }}>
                <Typography color="text.secondary">見つかりません</Typography>
              </Stack>
            )}
          </Box>
          {value && (
            <Box sx={{ mt: 2 }}>
              <Button size="small" color="inherit" onClick={() => handleSelect("")}>
                アイコンをクリア
              </Button>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
