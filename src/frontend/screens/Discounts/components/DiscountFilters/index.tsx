import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Autocomplete,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Select,
  Slider,
  TextField,
  Tooltip
} from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import SearchBar from 'frontend/components/UI/SearchBar'
import type { CatalogFeature, CatalogGenre } from 'common/types/discounts'
import {
  OS_OPTIONS,
  PAGE_SIZE_OPTIONS,
  PEGI_AGE_OPTIONS,
  RATING_SCALE_MAX,
  type DiscountSort,
  type OsOption,
  type PegiAge
} from '../../helpers'
import './index.css'

interface Props {
  sortBy: DiscountSort
  onSortChange: (sort: DiscountSort) => void
  priceMax: number
  priceRange: [number, number]
  onPriceChange: (range: [number, number]) => void
  currencyCode: string
  ratingRange: [number, number]
  onRatingChange: (range: [number, number]) => void
  releaseYearBounds: [number, number]
  releaseYearRange: [number, number]
  onReleaseYearChange: (range: [number, number]) => void
  maxPegiAge: PegiAge | null
  onMaxPegiAgeChange: (age: PegiAge | null) => void
  genreOptions: CatalogGenre[]
  selectedGenres: string[]
  onGenresChange: (slugs: string[]) => void
  featureOptions: CatalogFeature[]
  selectedFeatures: string[]
  onFeaturesChange: (slugs: string[]) => void
  selectedOS: OsOption[]
  onOSChange: (slugs: OsOption[]) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  hideDlcs: boolean
  onHideDlcsChange: (value: boolean) => void
  hideOwned: boolean
  onHideOwnedChange: (value: boolean) => void
  wishlistOnly: boolean
  onWishlistOnlyChange: (value: boolean) => void
  isGogLoggedIn: boolean
  pageSize: number
  onPageSizeChange: (value: number) => void
  onReset: () => void
  hasActiveFilters: boolean
}

const OS_PLATFORM_KEY: Record<OsOption, 'win' | 'linux' | 'mac'> = {
  windows: 'win',
  linux: 'linux',
  osx: 'mac'
}

interface SlugOption {
  slug: string
  name: string
}

interface MultiSelectChipsProps<T extends SlugOption> {
  label: string
  placeholder: string
  options: T[]
  selected: string[]
  onChange: (slugs: string[]) => void
}

const MultiSelectChips = <T extends SlugOption>({
  label,
  placeholder,
  options,
  selected,
  onChange
}: MultiSelectChipsProps<T>) => {
  const selectedOptions = options.filter((o) => selected.includes(o.slug))

  return (
    <div className="discountFilters__field">
      <label className="discountFilters__label">
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="discountFilters__labelMeta">{selected.length}</span>
        )}
      </label>
      <Tooltip
        arrow
        placement="bottom-start"
        disableHoverListener={selected.length <= 3}
        title={
          selected.length > 3 ? (
            <div className="discountFilters__tooltipChips">
              {selectedOptions.map((o) => (
                <Chip
                  key={o.slug}
                  size="small"
                  label={o.name}
                  className="discountFilters__chip"
                />
              ))}
            </div>
          ) : (
            ''
          )
        }
      >
        <Autocomplete
          multiple
          size="small"
          limitTags={2}
          options={options}
          value={selectedOptions}
          onChange={(_, value) => onChange(value.map((o) => o.slug))}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.slug === b.slug}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...rest } = getTagProps({ index })
              return (
                <Chip
                  key={key}
                  size="small"
                  label={option.name}
                  {...rest}
                  className="discountFilters__chip"
                />
              )
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={selected.length === 0 ? placeholder : ''}
            />
          )}
          className="discountFilters__autocomplete"
        />
      </Tooltip>
    </div>
  )
}

const DiscountFilters = ({
  sortBy,
  onSortChange,
  priceMax,
  priceRange,
  onPriceChange,
  currencyCode,
  ratingRange,
  onRatingChange,
  releaseYearBounds,
  releaseYearRange,
  onReleaseYearChange,
  maxPegiAge,
  onMaxPegiAgeChange,
  genreOptions,
  selectedGenres,
  onGenresChange,
  featureOptions,
  selectedFeatures,
  onFeaturesChange,
  selectedOS,
  onOSChange,
  searchQuery,
  onSearchChange,
  hideDlcs,
  onHideDlcsChange,
  hideOwned,
  onHideOwnedChange,
  wishlistOnly,
  onWishlistOnlyChange,
  isGogLoggedIn,
  pageSize,
  onPageSizeChange,
  onReset,
  hasActiveFilters
}: Props) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const toggleOS = (os: OsOption) => {
    onOSChange(
      selectedOS.includes(os)
        ? selectedOS.filter((o) => o !== os)
        : [...selectedOS, os]
    )
  }

  const osLabel = t('discounts.filters.os', 'Operating system')

  // Count of filters hidden inside the collapsible that are currently narrowing
  // results. Surfaces on the "More filters" toggle so a user returning with
  // persisted filters can see there's non-default state before expanding.
  const priceActive = priceRange[0] !== 0 || priceRange[1] !== priceMax
  const ratingActive =
    ratingRange[0] !== 0 || ratingRange[1] !== RATING_SCALE_MAX
  const releaseYearActive =
    releaseYearRange[0] !== releaseYearBounds[0] ||
    releaseYearRange[1] !== releaseYearBounds[1]
  const collapsedActiveCount =
    (sortBy !== 'trending' ? 1 : 0) +
    (selectedGenres.length > 0 ? 1 : 0) +
    (selectedFeatures.length > 0 ? 1 : 0) +
    (selectedOS.length > 0 ? 1 : 0) +
    (maxPegiAge !== null ? 1 : 0) +
    (priceActive ? 1 : 0) +
    (ratingActive ? 1 : 0) +
    (releaseYearActive ? 1 : 0)

  return (
    <section
      className="discountFilters"
      aria-label={t('header.filters', 'Filters')}
    >
      <header className="discountFilters__header">
        <h3 className="discountFilters__title">
          {t('header.filters', 'Filters')}
        </h3>
        <div className="discountFilters__headerActions">
          <button
            type="button"
            className={`discountFilters__toggle${
              collapsedActiveCount > 0
                ? ' discountFilters__toggle--hasActive'
                : ''
            }`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="discountFilters__collapsible"
          >
            <span>
              {expanded
                ? t('discounts.filters.lessFilters', 'Less filters')
                : t('discounts.filters.moreFilters', 'More filters')}
            </span>
            {collapsedActiveCount > 0 && (
              <span
                className="discountFilters__toggleBadge"
                aria-label={t(
                  'discounts.filters.activeCount',
                  '{{count}} active',
                  { count: collapsedActiveCount }
                )}
              >
                {collapsedActiveCount}
              </span>
            )}
            <ExpandMore
              fontSize="small"
              className={`discountFilters__toggleIcon${
                expanded ? ' discountFilters__toggleIcon--open' : ''
              }`}
            />
          </button>
          <button
            type="button"
            className="discountFilters__reset"
            onClick={onReset}
            disabled={!hasActiveFilters}
          >
            {t('header.reset', 'Reset')}
          </button>
        </div>
      </header>

      <div className="discountFilters__row discountFilters__row--search">
        <SearchBar
          value={searchQuery}
          onInputChanged={onSearchChange}
          placeholder={t('search', 'Search for Games')}
        />
        {isGogLoggedIn && (
          <>
            <FormControlLabel
              className="discountFilters__wishlistOnly"
              control={
                <Checkbox
                  size="small"
                  checked={wishlistOnly}
                  onChange={(e) => onWishlistOnlyChange(e.target.checked)}
                />
              }
              label={t('discounts.filters.wishlistOnly', 'Wishlist Only')}
            />
            <FormControlLabel
              className="discountFilters__hideOwned"
              control={
                <Checkbox
                  size="small"
                  checked={hideOwned}
                  onChange={(e) => onHideOwnedChange(e.target.checked)}
                />
              }
              label={t('discounts.filters.hideOwned', 'Hide Owned')}
            />
          </>
        )}
        <FormControlLabel
          className="discountFilters__hideDlcs"
          control={
            <Checkbox
              size="small"
              checked={hideDlcs}
              onChange={(e) => onHideDlcsChange(e.target.checked)}
            />
          }
          label={t('discounts.filters.hideDlcs', 'Hide DLCs')}
        />
      </div>

      <div
        id="discountFilters__collapsible"
        className={`discountFilters__collapsible${
          expanded ? ' discountFilters__collapsible--open' : ''
        }`}
        aria-hidden={!expanded}
      >
        <div className="discountFilters__collapsibleInner">
          <div className="discountFilters__row discountFilters__row--inputs">
            <div className="discountFilters__field">
              <label className="discountFilters__label">
                {t('discounts.filters.sort', 'Sort by')}
              </label>
              <Select
                size="small"
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as DiscountSort)}
                className="discountFilters__select"
              >
                <MenuItem value="trending">
                  {t('discounts.sort.trending', 'Trending')}
                </MenuItem>
                <MenuItem value="discount">
                  {t('discounts.sort.discount', 'Biggest discount')}
                </MenuItem>
                <MenuItem value="price-asc">
                  {t('discounts.sort.priceAsc', 'Price: low to high')}
                </MenuItem>
                <MenuItem value="price-desc">
                  {t('discounts.sort.priceDesc', 'Price: high to low')}
                </MenuItem>
                <MenuItem value="release-desc">
                  {t('discounts.sort.releaseDesc', 'Release date: new to old')}
                </MenuItem>
                <MenuItem value="release-asc">
                  {t('discounts.sort.releaseAsc', 'Release date: old to new')}
                </MenuItem>
                <MenuItem value="rating-desc">
                  {t('discounts.sort.ratingDesc', 'Rating: high to low')}
                </MenuItem>
                <MenuItem value="rating-asc">
                  {t('discounts.sort.ratingAsc', 'Rating: low to high')}
                </MenuItem>
              </Select>
            </div>

            <MultiSelectChips
              label={t('discounts.filters.genres', 'Genres')}
              placeholder={t(
                'discounts.filters.genresPlaceholder',
                'Any genre'
              )}
              options={genreOptions}
              selected={selectedGenres}
              onChange={onGenresChange}
            />

            <MultiSelectChips
              label={t('discounts.filters.features', 'Features')}
              placeholder={t(
                'discounts.filters.featuresPlaceholder',
                'Any feature'
              )}
              options={featureOptions}
              selected={selectedFeatures}
              onChange={onFeaturesChange}
            />

            <div className="discountFilters__field">
              <label className="discountFilters__label">{osLabel}</label>
              <div
                className="discountFilters__segmented"
                role="group"
                aria-label={osLabel}
              >
                {OS_OPTIONS.map((os) => {
                  const active = selectedOS.includes(os)
                  return (
                    <button
                      key={os}
                      type="button"
                      className={`discountFilters__segment${
                        active ? ' discountFilters__segment--active' : ''
                      }`}
                      aria-pressed={active}
                      onClick={() => toggleOS(os)}
                    >
                      {t(`platforms.${OS_PLATFORM_KEY[os]}`)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="discountFilters__field">
              <label className="discountFilters__label">
                <span>
                  {t('discounts.filters.ageRating', 'Suitable for age')}
                </span>
                {maxPegiAge !== null && (
                  <span className="discountFilters__labelValue">
                    PEGI ≤ {maxPegiAge}
                  </span>
                )}
              </label>
              <div
                className="discountFilters__segmented"
                role="group"
                aria-label={t(
                  'discounts.filters.ageRating',
                  'Suitable for age'
                )}
              >
                <button
                  type="button"
                  className={`discountFilters__segment${
                    maxPegiAge === null
                      ? ' discountFilters__segment--active'
                      : ''
                  }`}
                  aria-pressed={maxPegiAge === null}
                  onClick={() => onMaxPegiAgeChange(null)}
                >
                  {t('discounts.filters.ageRatingAll', 'All')}
                </button>
                {PEGI_AGE_OPTIONS.map((age) => {
                  const active = maxPegiAge === age
                  return (
                    <button
                      key={age}
                      type="button"
                      className={`discountFilters__segment${
                        active ? ' discountFilters__segment--active' : ''
                      }`}
                      aria-pressed={active}
                      title={t(
                        'discounts.filters.ageRatingOption',
                        'Show games rated PEGI {{age}} or lower',
                        { age }
                      )}
                      onClick={() => onMaxPegiAgeChange(age)}
                    >
                      {age}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="discountFilters__field discountFilters__field--pageSize">
              <label className="discountFilters__label">
                {t('discounts.filters.pageSize', 'Per page')}
              </label>
              <Select
                size="small"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="discountFilters__select"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </div>
          </div>

          <div className="discountFilters__row discountFilters__row--sliders">
            <div className="discountFilters__field discountFilters__field--slider">
              <label className="discountFilters__label">
                <span>{t('discounts.filters.price', 'Price')}</span>
                <span className="discountFilters__labelValue">
                  {currencyCode} {priceRange[0].toFixed(0)} –{' '}
                  {priceRange[1].toFixed(0)}
                </span>
              </label>
              <Slider
                size="small"
                value={priceRange}
                onChange={(_, value) =>
                  onPriceChange(value as [number, number])
                }
                min={0}
                max={priceMax}
                step={1}
                valueLabelDisplay="auto"
                className="discountFilters__slider"
              />
              <div className="discountFilters__sliderBounds">
                <span>{currencyCode} 0</span>
                <span>
                  {currencyCode} {priceMax}
                </span>
              </div>
            </div>

            <div className="discountFilters__field discountFilters__field--slider">
              <label className="discountFilters__label">
                <span>{t('discounts.filters.rating', 'Rating')}</span>
                <span className="discountFilters__labelValue">
                  {ratingRange[0].toFixed(1)} – {ratingRange[1].toFixed(1)}
                </span>
              </label>
              <Slider
                size="small"
                value={ratingRange}
                onChange={(_, value) =>
                  onRatingChange(value as [number, number])
                }
                min={0}
                max={RATING_SCALE_MAX}
                step={0.5}
                valueLabelDisplay="auto"
                className="discountFilters__slider"
              />
              <div className="discountFilters__sliderBounds">
                <span>0.0</span>
                <span>{RATING_SCALE_MAX.toFixed(1)}</span>
              </div>
            </div>

            <div className="discountFilters__field discountFilters__field--slider">
              <label className="discountFilters__label">
                <span>
                  {t('discounts.filters.releaseYear', 'Release year')}
                </span>
                <span className="discountFilters__labelValue">
                  {releaseYearRange[0]} – {releaseYearRange[1]}
                </span>
              </label>
              <Slider
                size="small"
                value={releaseYearRange}
                onChange={(_, value) =>
                  onReleaseYearChange(value as [number, number])
                }
                min={releaseYearBounds[0]}
                max={releaseYearBounds[1]}
                step={1}
                valueLabelDisplay="auto"
                disabled={releaseYearBounds[0] === releaseYearBounds[1]}
                className="discountFilters__slider"
              />
              <div className="discountFilters__sliderBounds">
                <span>{releaseYearBounds[0]}</span>
                <span>{releaseYearBounds[1]}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default DiscountFilters
